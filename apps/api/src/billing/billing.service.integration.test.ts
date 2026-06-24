import "reflect-metadata";
import assert from "node:assert/strict";
import { createCipheriv, createHmac, createSign, createVerify, generateKeyPairSync, randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import Stripe from "stripe";
import { loadEnv } from "../config/load-env";
import { PrismaService } from "../prisma/prisma.service";
import { BillingService } from "./billing.service";
import { MockPaymentProvider, StripePaymentProvider, WechatPayProvider } from "./payment-provider";

loadEnv();
const prisma = new PrismaService();
const billing = new BillingService(prisma, [
  new MockPaymentProvider(), new StripePaymentProvider(), new WechatPayProvider()
]);
const PREFIX = "billing-integration-";
const WECHAT_API_V3_KEY = "12345678901234567890123456789012";
const wechatMerchantKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const wechatPlatformKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const WECHAT_MERCHANT_PRIVATE_KEY = wechatMerchantKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const WECHAT_MERCHANT_PUBLIC_KEY = wechatMerchantKeys.publicKey.export({ type: "spki", format: "pem" }).toString();
const WECHAT_PLATFORM_PRIVATE_KEY = wechatPlatformKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const WECHAT_PLATFORM_PUBLIC_KEY = wechatPlatformKeys.publicKey.export({ type: "spki", format: "pem" }).toString();

describe("BillingService integration", () => {
  before(cleanup);
  after(async () => { await cleanup(); await prisma.$disconnect(); });

  it("creates a checkout order and activates membership exactly once", async () => {
    const user = await createUser("paid");
    const plans = await billing.listPlans();
    const created = await billing.createOrder(user.id, { provider: "MOCK", durationDays: 30 });
    assert.equal(created.order.status, "PENDING");
    assert.equal(plans.plans.some((plan) => plan.code === "PRO_30D"), true);
    assert.equal(created.order.planCode, "PRO_30D");
    assert.equal(created.order.planName, "GoalMate Pro 30 days");
    assert.match(created.order.checkoutUrl!, /mock-checkout/);
    const payload = {
      eventId: `evt-${Date.now()}`,
      orderId: created.order.id,
      status: "PAID",
      amountCents: created.order.amountCents,
      providerPaymentId: `pay-${Date.now()}`
    };
    const signature = sign(payload);
    const first = await billing.processWebhook("MOCK", payload, signature);
    const membershipAfterFirst = await prisma.membership.findUniqueOrThrow({ where: { userId: user.id } });
    const replay = await billing.processWebhook("MOCK", payload, signature);
    const membershipAfterReplay = await prisma.membership.findUniqueOrThrow({ where: { userId: user.id } });
    const [events, audits, subscription, payments, entitlements] = await Promise.all([
      prisma.paymentEvent.count({ where: { orderId: created.order.id } }),
      prisma.membershipAudit.count({ where: { orderId: created.order.id } }),
      prisma.subscription.findFirst({ where: { userId: user.id } }),
      prisma.paymentTransaction.count({ where: { orderId: created.order.id, type: "PAYMENT", status: "SUCCEEDED" } }),
      prisma.entitlement.count({ where: { userId: user.id, source: `PAYMENT:MOCK:${created.order.id}` } })
    ]);
    assert.equal("activated" in first ? first.activated : false, true);
    assert.equal(replay.duplicate, true);
    assert.ok(subscription);
    assert.equal(subscription?.status, "ACTIVE");
    assert.equal(membershipAfterFirst.plan, "PRO");
    assert.equal(membershipAfterReplay.expiresAt?.toISOString(), membershipAfterFirst.expiresAt?.toISOString());
    assert.equal(events, 1);
    assert.equal(audits, 1);
    assert.equal(payments, 1);
    assert.equal(entitlements, 8);
  });

  it("does not extend membership twice when a second paid event arrives for the same order", async () => {
    const user = await createUser("paid-twice");
    const created = await billing.createOrder(user.id, { durationDays: 30 });
    const firstPayload = { eventId: `paid-a-${Date.now()}`, orderId: created.order.id, status: "PAID", amountCents: created.order.amountCents };
    await billing.processWebhook("MOCK", firstPayload, sign(firstPayload));
    const membershipAfterFirst = await prisma.membership.findUniqueOrThrow({ where: { userId: user.id } });
    const secondPayload = { eventId: `paid-b-${Date.now()}`, orderId: created.order.id, status: "PAID", amountCents: created.order.amountCents };
    const second = await billing.processWebhook("MOCK", secondPayload, sign(secondPayload));
    const membershipAfterSecond = await prisma.membership.findUniqueOrThrow({ where: { userId: user.id } });
    const audits = await prisma.membershipAudit.count({ where: { orderId: created.order.id, action: "PAYMENT_ACTIVATED" } });

    assert.equal("activated" in second ? second.activated : true, false);
    assert.equal("reason" in second ? second.reason : null, "ORDER_PAID");
    assert.equal(membershipAfterSecond.expiresAt?.toISOString(), membershipAfterFirst.expiresAt?.toISOString());
    assert.equal(audits, 1);
  });

  it("rejects amount mismatches without granting entitlements", async () => {
    const user = await createUser("mismatch");
    const created = await billing.createOrder(user.id, { durationDays: 30 });
    const payload = { eventId: `mismatch-${Date.now()}`, orderId: created.order.id, status: "PAID", amountCents: created.order.amountCents + 1 };

    await assert.rejects(
      () => billing.processWebhook("MOCK", payload, sign(payload)),
      BadRequestException
    );

    const [membership, events, entitlements] = await Promise.all([
      prisma.membership.findUnique({ where: { userId: user.id } }),
      prisma.paymentEvent.count({ where: { orderId: created.order.id } }),
      prisma.entitlement.count({ where: { userId: user.id } })
    ]);

    assert.equal(membership, null);
    assert.equal(events, 0);
    assert.equal(entitlements, 0);
  });

  it("records failed payments without granting Pro", async () => {
    const user = await createUser("failed");
    const created = await billing.createOrder(user.id, { durationDays: 90 });
    const payload = { eventId: `failed-${Date.now()}`, orderId: created.order.id, status: "FAILED" };
    const result = await billing.processWebhook("mock", payload, sign(payload));
    const order = await prisma.paymentOrder.findUniqueOrThrow({ where: { id: created.order.id } });
    const [membership, payment] = await Promise.all([
      prisma.membership.findUnique({ where: { userId: user.id } }),
      prisma.paymentTransaction.findFirst({ where: { orderId: created.order.id } })
    ]);
    assert.equal("activated" in result ? result.activated : true, false);
    assert.equal(order.status, "FAILED");
    assert.equal(membership, null);
    assert.equal(payment?.status, "FAILED");
  });

  it("refunds a paid order and revokes the entitlements it granted", async () => {
    const user = await createUser("refund");
    const created = await billing.createOrder(user.id, { durationDays: 90 });
    const paidPayload = { eventId: `paid-refund-${Date.now()}`, orderId: created.order.id, status: "PAID", amountCents: created.order.amountCents };
    await billing.processWebhook("MOCK", paidPayload, sign(paidPayload));
    const refundPayload = { eventId: `refund-${Date.now()}`, orderId: created.order.id, status: "REFUNDED", amountCents: created.order.amountCents, reason: "用户申请退款" };
    const refund = await billing.processWebhook("MOCK", refundPayload, sign(refundPayload));
    const [order, membership, activeEntitlements, refundPayment, audit] = await Promise.all([
      prisma.paymentOrder.findUniqueOrThrow({ where: { id: created.order.id } }),
      prisma.membership.findUnique({ where: { userId: user.id } }),
      prisma.entitlement.count({
        where: {
          userId: user.id,
          source: `PAYMENT:MOCK:${created.order.id}`,
          OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }]
        }
      }),
      prisma.paymentTransaction.findFirst({ where: { orderId: created.order.id, type: "REFUND" } }),
      prisma.membershipAudit.findFirst({ where: { orderId: created.order.id, action: "PAYMENT_REFUNDED" } })
    ]);

    assert.equal("revoked" in refund ? refund.revoked : 0, 8);
    assert.equal(order.status, "REFUNDED");
    assert.equal(membership?.plan, "FREE");
    assert.equal(membership?.status, "EXPIRED");
    assert.equal(activeEntitlements, 0);
    assert.equal(refundPayment?.refundedCents, created.order.amountCents);
    assert.ok(audit);
  });

  it("marks cancellation at period end without immediately revoking access", async () => {
    const user = await createUser("cancel");
    const created = await billing.createOrder(user.id, { durationDays: 30 });
    const paidPayload = { eventId: `paid-cancel-${Date.now()}`, orderId: created.order.id, status: "PAID", amountCents: created.order.amountCents };
    await billing.processWebhook("MOCK", paidPayload, sign(paidPayload));
    const cancelPayload = { eventId: `cancel-${Date.now()}`, orderId: created.order.id, status: "CANCELED", amountCents: created.order.amountCents, reason: "用户取消自动续费" };
    const canceled = await billing.processWebhook("MOCK", cancelPayload, sign(cancelPayload));
    const [subscription, membership, activeEntitlements] = await Promise.all([
      prisma.subscription.findFirstOrThrow({ where: { userId: user.id } }),
      prisma.membership.findUniqueOrThrow({ where: { userId: user.id } }),
      prisma.entitlement.count({
        where: {
          userId: user.id,
          source: `PAYMENT:MOCK:${created.order.id}`,
          OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }]
        }
      })
    ]);

    assert.equal("canceled" in canceled ? canceled.canceled : false, true);
    assert.equal(subscription.cancelAtPeriodEnd, true);
    assert.equal(subscription.status, "ACTIVE");
    assert.equal(membership.plan, "PRO");
    assert.equal(activeEntitlements, 8);
  });

  it("allows an administrator refund path to revoke paid access", async () => {
    const user = await createUser("admin-refund");
    const created = await billing.createOrder(user.id, { durationDays: 30 });
    const paidPayload = { eventId: `paid-admin-refund-${Date.now()}`, orderId: created.order.id, status: "PAID", amountCents: created.order.amountCents };
    await billing.processWebhook("MOCK", paidPayload, sign(paidPayload));

    const result = await billing.adminRefundOrder("admin-user-id", created.order.id, { reason: "客服确认线下退款" });
    const membership = await prisma.membership.findUnique({ where: { userId: user.id } });

    assert.equal(result.revoked, 8);
    assert.equal(result.order.status, "REFUNDED");
    assert.equal(membership?.status, "EXPIRED");
  });

  it("creates a Stripe Checkout Session with server-owned plan pricing", async () => {
    const user = await createUser("stripe-checkout");
    const captured: Stripe.Checkout.SessionCreateParams[] = [];
    const stripeBilling = createStripeBilling(captured);

    const created = await stripeBilling.createOrder(user.id, {
      provider: "STRIPE",
      planCode: "PRO_365D",
      amountCents: 1
    });
    const session = captured[0];

    assert.equal(created.order.provider, "STRIPE");
    assert.equal(created.order.planCode, "PRO_365D");
    assert.equal(created.order.amountCents, 16800);
    assert.match(created.order.providerOrderId ?? "", /^cs_test_/);
    assert.match(created.order.checkoutUrl ?? "", /^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_/);
    assert.equal(session.mode, "payment");
    assert.equal(session.client_reference_id, created.order.id);
    assert.equal(session.metadata?.orderId, created.order.id);
    assert.equal(session.payment_intent_data?.metadata?.orderId, created.order.id);
    assert.equal(session.line_items?.[0]?.price_data?.unit_amount, 16800);
    assert.equal(session.line_items?.[0]?.price_data?.currency, "cny");
  });

  it("verifies Stripe raw webhook signatures and activates paid orders once", async () => {
    const user = await createUser("stripe-webhook");
    const stripeBilling = createStripeBilling();
    const created = await stripeBilling.createOrder(user.id, { provider: "STRIPE", durationDays: 30 });
    const event = stripeCheckoutEvent(created.order.id, created.order.amountCents);
    const raw = JSON.stringify(event);
    const signature = signStripe(raw);

    const first = await stripeBilling.processWebhook("STRIPE", raw, signature);
    const replay = await stripeBilling.processWebhook("STRIPE", raw, signature);

    await assert.rejects(
      () => stripeBilling.processWebhook("STRIPE", JSON.parse(raw), signature),
      BadRequestException
    );
    await assert.rejects(
      () => stripeBilling.processWebhook("STRIPE", raw, "t=123,v1=bad"),
      BadRequestException
    );

    const [membership, payment, entitlements] = await Promise.all([
      prisma.membership.findUnique({ where: { userId: user.id } }),
      prisma.paymentTransaction.findFirst({ where: { orderId: created.order.id, provider: "STRIPE" } }),
      prisma.entitlement.count({ where: { userId: user.id, source: `PAYMENT:STRIPE:${created.order.id}` } })
    ]);

    assert.equal("activated" in first ? first.activated : false, true);
    assert.equal(replay.duplicate, true);
    assert.equal(membership?.plan, "PRO");
    assert.equal(payment?.providerPaymentId, "pi_test_unit");
    assert.equal(entitlements, 8);
  });

  it("rejects Stripe amount mismatches before recording payment events", async () => {
    const user = await createUser("stripe-mismatch");
    const stripeBilling = createStripeBilling();
    const created = await stripeBilling.createOrder(user.id, { provider: "STRIPE", durationDays: 30 });
    const raw = JSON.stringify(stripeCheckoutEvent(created.order.id, created.order.amountCents + 1));

    await assert.rejects(
      () => stripeBilling.processWebhook("STRIPE", raw, signStripe(raw)),
      BadRequestException
    );

    const [events, membership, entitlements] = await Promise.all([
      prisma.paymentEvent.count({ where: { orderId: created.order.id } }),
      prisma.membership.findUnique({ where: { userId: user.id } }),
      prisma.entitlement.count({ where: { userId: user.id } })
    ]);

    assert.equal(events, 0);
    assert.equal(membership, null);
    assert.equal(entitlements, 0);
  });

  it("creates a WeChat Pay Native order with signed server-owned pricing", async () => {
    const user = await createUser("wechat-checkout");
    const captured: Array<{ url: string; init: { headers: Record<string, string>; body?: string } }> = [];
    const wechatBilling = createWechatBilling(captured);

    const created = await wechatBilling.createOrder(user.id, {
      provider: "WECHAT_PAY",
      planCode: "PRO_90D",
      amountCents: 1
    });
    const request = captured[0];
    const body = JSON.parse(request.init.body ?? "{}") as {
      out_trade_no: string;
      amount: { total: number; currency: string };
      mchid: string;
      appid: string;
      notify_url: string;
    };

    assert.equal(created.order.provider, "WECHAT_PAY");
    assert.equal(created.order.planCode, "PRO_90D");
    assert.equal(created.order.amountCents, 4900);
    assert.match(created.order.checkoutUrl ?? "", /^weixin:\/\/wxpay\/bizpayurl/);
    assert.equal(request.url, "https://api.mch.weixin.qq.com/v3/pay/transactions/native");
    assert.equal(body.out_trade_no, created.order.id);
    assert.equal(body.amount.total, 4900);
    assert.equal(body.amount.currency, "CNY");
    assert.equal(body.mchid, "1900000001");
    assert.equal(body.appid, "wx-test-app");
    assert.equal(body.notify_url, "https://goalmate.test/billing/webhooks/wechat_pay");
    assert.equal(verifyWechatAuthorization(request.init.headers.Authorization, request.init.body ?? ""), true);
  });

  it("verifies and decrypts WeChat Pay notifications before activating access", async () => {
    const user = await createUser("wechat-webhook");
    const wechatBilling = createWechatBilling();
    const created = await wechatBilling.createOrder(user.id, { provider: "WECHAT_PAY", durationDays: 30 });
    const notify = signWechatNotification(wechatTransactionResource(created.order.id, created.order.amountCents));

    const first = await wechatBilling.processWebhook("WECHAT_PAY", notify.raw, notify.headers);
    const replay = await wechatBilling.processWebhook("WECHAT_PAY", notify.raw, notify.headers);
    await assert.rejects(
      () => wechatBilling.processWebhook("WECHAT_PAY", notify.raw, { ...notify.headers, signature: "bad" }),
      BadRequestException
    );

    const [membership, payment, entitlements] = await Promise.all([
      prisma.membership.findUnique({ where: { userId: user.id } }),
      prisma.paymentTransaction.findFirst({ where: { orderId: created.order.id, provider: "WECHAT_PAY" } }),
      prisma.entitlement.count({ where: { userId: user.id, source: `PAYMENT:WECHAT_PAY:${created.order.id}` } })
    ]);

    assert.equal("activated" in first ? first.activated : false, true);
    assert.equal(replay.duplicate, true);
    assert.equal(membership?.plan, "PRO");
    assert.equal(payment?.providerPaymentId, "4200000000000000001");
    assert.equal(entitlements, 8);
  });

  it("rejects WeChat Pay amount mismatches before recording payment events", async () => {
    const user = await createUser("wechat-mismatch");
    const wechatBilling = createWechatBilling();
    const created = await wechatBilling.createOrder(user.id, { provider: "WECHAT_PAY", durationDays: 30 });
    const notify = signWechatNotification(wechatTransactionResource(created.order.id, created.order.amountCents + 1));

    await assert.rejects(
      () => wechatBilling.processWebhook("WECHAT_PAY", notify.raw, notify.headers),
      BadRequestException
    );

    const [events, membership, entitlements] = await Promise.all([
      prisma.paymentEvent.count({ where: { orderId: created.order.id } }),
      prisma.membership.findUnique({ where: { userId: user.id } }),
      prisma.entitlement.count({ where: { userId: user.id } })
    ]);

    assert.equal(events, 0);
    assert.equal(membership, null);
    assert.equal(entitlements, 0);
  });

  it("handles WeChat Pay refund notifications through the unified entitlement model", async () => {
    const user = await createUser("wechat-refund");
    const wechatBilling = createWechatBilling();
    const created = await wechatBilling.createOrder(user.id, { provider: "WECHAT_PAY", durationDays: 30 });
    const paidNotify = signWechatNotification(wechatTransactionResource(created.order.id, created.order.amountCents));
    await wechatBilling.processWebhook("WECHAT_PAY", paidNotify.raw, paidNotify.headers);

    const refundNotify = signWechatNotification(
      wechatRefundResource(created.order.id, created.order.amountCents),
      "REFUND.SUCCESS"
    );
    const refund = await wechatBilling.processWebhook("WECHAT_PAY", refundNotify.raw, refundNotify.headers);
    const [membership, activeEntitlements, refundPayment] = await Promise.all([
      prisma.membership.findUnique({ where: { userId: user.id } }),
      prisma.entitlement.count({
        where: {
          userId: user.id,
          source: `PAYMENT:WECHAT_PAY:${created.order.id}`,
          OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }]
        }
      }),
      prisma.paymentTransaction.findFirst({ where: { orderId: created.order.id, type: "REFUND", provider: "WECHAT_PAY" } })
    ]);

    assert.equal("revoked" in refund ? refund.revoked : 0, 8);
    assert.equal(membership?.status, "EXPIRED");
    assert.equal(activeEntitlements, 0);
    assert.equal(refundPayment?.refundedCents, created.order.amountCents);
  });
});

function sign(payload: Record<string, unknown>) {
  return createHmac("sha256", process.env.MOCK_PAYMENT_WEBHOOK_SECRET || "goalmate-mock-payment")
    .update(JSON.stringify(payload)).digest("hex");
}
function createStripeBilling(captured: Stripe.Checkout.SessionCreateParams[] = []) {
  const stripe = new Stripe("sk_test_unit");
  const stripeProvider = new StripePaymentProvider({
    checkout: {
      sessions: {
        create: async (params: Stripe.Checkout.SessionCreateParams) => {
          captured.push(params);
          const sessionId = `cs_test_${String(params.client_reference_id ?? "unit").replace(/[^a-zA-Z0-9_]/g, "_")}`;
          return {
            id: sessionId,
            url: `https://checkout.stripe.com/c/pay/${sessionId}`
          };
        }
      }
    },
    webhooks: stripe.webhooks
  } as unknown as Pick<Stripe, "checkout" | "webhooks">, {
    secretKey: "sk_test_unit",
    webhookSecret: "whsec_unit",
    successUrl: "https://goalmate.test/billing/success?session_id={CHECKOUT_SESSION_ID}",
    cancelUrl: "https://goalmate.test/billing/cancel"
  });
  return new BillingService(prisma, [
    new MockPaymentProvider(),
    stripeProvider,
    new WechatPayProvider()
  ]);
}
function stripeCheckoutEvent(orderId: string, amountCents: number) {
  return {
    id: `evt_stripe_${orderId}`,
    object: "event",
    livemode: false,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_unit",
        object: "checkout.session",
        client_reference_id: orderId,
        amount_total: amountCents,
        currency: "cny",
        payment_intent: "pi_test_unit",
        metadata: {
          orderId
        }
      }
    }
  };
}
function signStripe(raw: string) {
  return new Stripe("sk_test_unit").webhooks.generateTestHeaderString({
    payload: raw,
    secret: "whsec_unit"
  });
}
function createWechatBilling(captured: Array<{ url: string; init: { headers: Record<string, string>; body?: string } }> = []) {
  const provider = new WechatPayProvider(async (url, init) => {
    captured.push({ url, init });
    const body = JSON.parse(init.body ?? "{}") as { out_trade_no?: string };
    return {
      ok: true,
      status: 200,
      json: async () => ({ code_url: `weixin://wxpay/bizpayurl?pr=${body.out_trade_no ?? "unit"}` }),
      text: async () => ""
    };
  }, {
    mchId: "1900000001",
    appId: "wx-test-app",
    merchantSerialNo: "wechat-merchant-serial",
    merchantPrivateKey: WECHAT_MERCHANT_PRIVATE_KEY,
    apiV3Key: WECHAT_API_V3_KEY,
    notifyUrl: "https://goalmate.test/billing/webhooks/wechat_pay",
    apiBaseUrl: "https://api.mch.weixin.qq.com",
    tradeType: "NATIVE",
    platformPublicKey: WECHAT_PLATFORM_PUBLIC_KEY
  });
  return new BillingService(prisma, [
    new MockPaymentProvider(),
    new StripePaymentProvider(),
    provider
  ]);
}
function verifyWechatAuthorization(header: string, body: string) {
  const parsed = Object.fromEntries(
    Array.from(header.matchAll(/([a-z_]+)="([^"]+)"/g)).map((match) => [match[1], match[2]])
  );
  const message = `POST\n/v3/pay/transactions/native\n${parsed.timestamp}\n${parsed.nonce_str}\n${body}\n`;
  assert.equal(parsed.mchid, "1900000001");
  assert.equal(parsed.serial_no, "wechat-merchant-serial");
  return createVerify("RSA-SHA256")
    .update(message)
    .verify(WECHAT_MERCHANT_PUBLIC_KEY, parsed.signature, "base64");
}
function wechatTransactionResource(orderId: string, amountCents: number) {
  return {
    appid: "wx-test-app",
    mchid: "1900000001",
    out_trade_no: orderId,
    transaction_id: "4200000000000000001",
    trade_state: "SUCCESS",
    trade_state_desc: "支付成功",
    amount: {
      total: amountCents,
      currency: "CNY"
    }
  };
}
function wechatRefundResource(orderId: string, amountCents: number) {
  return {
    mchid: "1900000001",
    out_trade_no: orderId,
    refund_id: "5030000000000000001",
    refund_status: "SUCCESS",
    amount: {
      total: amountCents,
      refund: amountCents,
      currency: "CNY"
    }
  };
}
function signWechatNotification(resource: Record<string, unknown>, eventType = "TRANSACTION.SUCCESS") {
  const body = {
    id: `wechat_evt_${String(resource.out_trade_no)}_${eventType}`,
    create_time: "2026-06-24T00:00:00+08:00",
    event_type: eventType,
    resource_type: "encrypt-resource",
    resource: encryptWechatResource(resource),
    summary: eventType
  };
  const raw = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomBytes(12).toString("hex");
  const signature = createSign("RSA-SHA256")
    .update(`${timestamp}\n${nonce}\n${raw}\n`)
    .sign(WECHAT_PLATFORM_PRIVATE_KEY, "base64");

  return {
    raw,
    headers: {
      signature,
      timestamp,
      nonce,
      serial: "wechat-platform-serial"
    }
  };
}
function encryptWechatResource(resource: Record<string, unknown>) {
  const nonce = randomBytes(12).toString("base64url").slice(0, 12);
  const associatedData = "transaction";
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(WECHAT_API_V3_KEY, "utf8"), Buffer.from(nonce, "utf8"));
  cipher.setAAD(Buffer.from(associatedData, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(resource), "utf8"),
    cipher.final(),
    cipher.getAuthTag()
  ]).toString("base64");

  return {
    algorithm: "AEAD_AES_256_GCM",
    ciphertext,
    associated_data: associatedData,
    nonce
  };
}
async function createUser(name: string) {
  return prisma.user.create({ data: { email: `${PREFIX}${name}-${Date.now()}@example.com`, passwordHash: "hash" } });
}
async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
}
