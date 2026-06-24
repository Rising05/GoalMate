import "reflect-metadata";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
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
async function createUser(name: string) {
  return prisma.user.create({ data: { email: `${PREFIX}${name}-${Date.now()}@example.com`, passwordHash: "hash" } });
}
async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
}
