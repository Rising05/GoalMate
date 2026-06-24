import { BadRequestException, Injectable } from "@nestjs/common";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import Stripe from "stripe";

export const PAYMENT_PROVIDERS = Symbol("PAYMENT_PROVIDERS");

export interface PaymentCheckoutInput {
  orderId: string;
  amountCents: number;
  currency: string;
  description: string;
}

export interface ParsedPaymentEvent {
  eventId: string;
  orderId: string;
  status: "PAID" | "FAILED" | "REFUNDED" | "DISPUTED" | "CANCELED";
  type: string;
  payload: Record<string, unknown>;
  amountCents?: number;
  providerPaymentId?: string | null;
  providerSubscriptionId?: string | null;
  reason?: string | null;
}

export interface PaymentProvider {
  readonly name: string;
  isConfigured(): boolean;
  createCheckout(input: PaymentCheckoutInput): Promise<{
    providerOrderId: string;
    checkoutUrl: string;
  }>;
  parseWebhook(input: unknown, signature?: string): ParsedPaymentEvent;
}

type StripeClient = Pick<Stripe, "checkout" | "webhooks">;

interface StripeProviderConfig {
  secretKey: string;
  webhookSecret: string;
  successUrl: string;
  cancelUrl: string;
}

abstract class HmacPaymentProvider implements PaymentProvider {
  abstract readonly name: string;
  abstract isConfigured(): boolean;
  protected abstract getSecret(): string;
  protected abstract getCheckoutBaseUrl(): string;

  async createCheckout(input: PaymentCheckoutInput) {
    const providerOrderId = `${this.name.toLowerCase()}-${randomUUID()}`;
    const baseUrl = this.getCheckoutBaseUrl();
    return {
      providerOrderId,
      checkoutUrl: `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}orderId=${encodeURIComponent(input.orderId)}&providerOrderId=${providerOrderId}`
    };
  }

  parseWebhook(input: unknown, signature?: string): ParsedPaymentEvent {
    const payload = input && typeof input === "object" && !Array.isArray(input)
      ? input as Record<string, unknown>
      : {};
    const expected = createHmac("sha256", this.getSecret())
      .update(JSON.stringify(payload))
      .digest("hex");
    const valid = Boolean(signature) && signature!.length === expected.length &&
      timingSafeEqual(Buffer.from(signature!), Buffer.from(expected));

    if (!valid) throw new BadRequestException("支付回调签名无效");
    const eventId = clean(payload.eventId);
    const orderId = clean(payload.orderId);
    const status = clean(payload.status).toUpperCase();
    const allowedStatuses = ["PAID", "FAILED", "REFUNDED", "DISPUTED", "CANCELED"];
    if (!eventId || !orderId || !allowedStatuses.includes(status)) {
      throw new BadRequestException("支付回调参数不正确");
    }
    const amountCents = parseOptionalInteger(payload.amountCents);
    const providerPaymentId = clean(payload.providerPaymentId) || null;
    const providerSubscriptionId = clean(payload.providerSubscriptionId) || null;
    const reason = clean(payload.reason) || null;
    return {
      eventId: `${this.name}:${eventId}`,
      orderId,
      status: status as ParsedPaymentEvent["status"],
      type: clean(payload.type) || `PAYMENT_${status}`,
      amountCents,
      providerPaymentId,
      providerSubscriptionId,
      reason,
      payload: {
        eventId,
        orderId,
        status,
        type: clean(payload.type) || `PAYMENT_${status}`,
        amountCents: amountCents ?? null,
        providerPaymentId,
        providerSubscriptionId,
        hasReason: reason !== null
      }
    };
  }
}

@Injectable()
export class MockPaymentProvider extends HmacPaymentProvider {
  readonly name = "MOCK";
  isConfigured() { return true; }
  protected getSecret() { return process.env.MOCK_PAYMENT_WEBHOOK_SECRET || "goalmate-mock-payment"; }
  protected getCheckoutBaseUrl() { return process.env.MOCK_PAYMENT_CHECKOUT_URL || "http://localhost/mock-checkout"; }
}

@Injectable()
export class StripePaymentProvider extends HmacPaymentProvider {
  readonly name = "STRIPE";
  constructor(
    private readonly stripeClient?: StripeClient,
    private readonly config: Partial<StripeProviderConfig> = {}
  ) { super(); }

  isConfigured() {
    return Boolean(this.getSecretKey() && this.getWebhookSecret() && this.getSuccessUrl() && this.getCancelUrl());
  }

  async createCheckout(input: PaymentCheckoutInput) {
    const session = await this.getStripe().checkout.sessions.create({
      mode: "payment",
      success_url: this.getSuccessUrl(),
      cancel_url: this.getCancelUrl(),
      client_reference_id: input.orderId,
      metadata: {
        orderId: input.orderId
      },
      payment_intent_data: {
        metadata: {
          orderId: input.orderId
        }
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: input.amountCents,
            product_data: {
              name: input.description,
              metadata: {
                orderId: input.orderId
              }
            }
          }
        }
      ]
    });

    if (!session.url) {
      throw new BadRequestException("Stripe Checkout Session 未返回支付链接");
    }

    return {
      providerOrderId: session.id,
      checkoutUrl: session.url
    };
  }

  parseWebhook(input: unknown, signature?: string) {
    if (!signature) {
      throw new BadRequestException("Stripe 回调签名缺失");
    }

    const rawBody = typeof input === "string" || Buffer.isBuffer(input) ? input : null;
    if (!rawBody) {
      throw new BadRequestException("Stripe 回调必须使用原始请求体验签");
    }

    let event: Stripe.Event;
    try {
      event = this.getStripe().webhooks.constructEvent(rawBody, signature, this.getWebhookSecret());
    } catch {
      throw new BadRequestException("Stripe 回调签名无效");
    }

    const object = event.data.object as unknown as Record<string, unknown>;
    const status = mapStripeEventStatus(event.type);
    const orderId = extractStripeOrderId(object);
    if (!orderId) {
      throw new BadRequestException("Stripe 回调缺少本地订单标识");
    }

    const amountCents = extractStripeAmountCents(object);
    const providerPaymentId = extractStripePaymentId(event.type, object) ?? event.id;
    const providerSubscriptionId = extractStripeSubscriptionId(object);

    return {
      eventId: `STRIPE:${event.id}`,
      orderId,
      status,
      type: event.type,
      amountCents,
      providerPaymentId,
      providerSubscriptionId,
      reason: extractStripeReason(object),
      payload: {
        eventId: event.id,
        orderId,
        status,
        type: event.type,
        amountCents: amountCents ?? null,
        providerPaymentId,
        providerSubscriptionId,
        hasReason: false,
        livemode: event.livemode
      }
    };
  }

  protected getSecret() { return this.getWebhookSecret(); }
  protected getCheckoutBaseUrl() { return ""; }

  private getStripe() {
    if (this.stripeClient) return this.stripeClient;
    return new Stripe(this.getSecretKey());
  }

  private getSecretKey() {
    return this.config.secretKey ?? process.env.STRIPE_SECRET_KEY ?? "";
  }

  private getWebhookSecret() {
    return this.config.webhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET ?? "";
  }

  private getSuccessUrl() {
    return this.config.successUrl ?? process.env.STRIPE_SUCCESS_URL ?? process.env.STRIPE_CHECKOUT_SUCCESS_URL ?? "";
  }

  private getCancelUrl() {
    return this.config.cancelUrl ?? process.env.STRIPE_CANCEL_URL ?? process.env.STRIPE_CHECKOUT_CANCEL_URL ?? "";
  }
}

@Injectable()
export class WechatPayProvider extends HmacPaymentProvider {
  readonly name = "WECHAT_PAY";
  isConfigured() { return Boolean(process.env.WECHAT_PAY_WEBHOOK_SECRET && process.env.WECHAT_PAY_CHECKOUT_URL); }
  protected getSecret() { return process.env.WECHAT_PAY_WEBHOOK_SECRET || ""; }
  protected getCheckoutBaseUrl() { return process.env.WECHAT_PAY_CHECKOUT_URL || ""; }
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 200) : "";
}

function parseOptionalInteger(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue >= 0 ? numberValue : undefined;
}

function mapStripeEventStatus(type: string): ParsedPaymentEvent["status"] {
  if ([
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "payment_intent.succeeded",
    "invoice.paid",
    "invoice.payment_succeeded"
  ].includes(type)) {
    return "PAID";
  }

  if (["checkout.session.async_payment_failed", "payment_intent.payment_failed", "invoice.payment_failed"].includes(type)) {
    return "FAILED";
  }

  if (["charge.refunded", "refund.created", "refund.updated"].includes(type)) {
    return "REFUNDED";
  }

  if (["charge.dispute.created", "charge.dispute.funds_withdrawn"].includes(type)) {
    return "DISPUTED";
  }

  if (["checkout.session.expired", "customer.subscription.deleted"].includes(type)) {
    return "CANCELED";
  }

  throw new BadRequestException("未支持的 Stripe 回调事件");
}

function extractStripeOrderId(object: Record<string, unknown>) {
  return clean(object.client_reference_id)
    || nestedClean(object, ["metadata", "orderId"])
    || nestedClean(object, ["subscription_details", "metadata", "orderId"]);
}

function extractStripeAmountCents(object: Record<string, unknown>) {
  return parseOptionalInteger(object.amount_total)
    ?? parseOptionalInteger(object.amount_paid)
    ?? parseOptionalInteger(object.amount)
    ?? parseOptionalInteger(object.amount_refunded);
}

function extractStripePaymentId(type: string, object: Record<string, unknown>) {
  if (type.startsWith("checkout.session")) {
    return cleanStripeId(object.payment_intent) || clean(object.id);
  }

  return clean(object.id) || cleanStripeId(object.payment_intent);
}

function extractStripeSubscriptionId(object: Record<string, unknown>) {
  return cleanStripeId(object.subscription) || clean(object.id && clean(object.object) === "subscription" ? object.id : null);
}

function extractStripeReason(object: Record<string, unknown>) {
  return clean(object.reason) || clean(object.status) || null;
}

function cleanStripeId(value: unknown) {
  if (typeof value === "string") return clean(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return clean((value as Record<string, unknown>).id);
  }
  return "";
}

function nestedClean(source: Record<string, unknown>, path: string[]) {
  let current: unknown = source;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return "";
    current = (current as Record<string, unknown>)[key];
  }
  return clean(current);
}
