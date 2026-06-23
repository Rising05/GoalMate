import { BadRequestException, Injectable } from "@nestjs/common";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

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

  parseWebhook(input: unknown, signature?: string) {
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
  isConfigured() { return Boolean(process.env.STRIPE_WEBHOOK_SECRET && process.env.STRIPE_CHECKOUT_URL); }
  protected getSecret() { return process.env.STRIPE_WEBHOOK_SECRET || ""; }
  protected getCheckoutBaseUrl() { return process.env.STRIPE_CHECKOUT_URL || ""; }
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
