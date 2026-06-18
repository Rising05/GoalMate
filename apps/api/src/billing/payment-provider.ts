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
  status: "PAID" | "FAILED";
  type: string;
  payload: Record<string, unknown>;
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
    if (!eventId || !orderId || !["PAID", "FAILED"].includes(status)) {
      throw new BadRequestException("支付回调参数不正确");
    }
    return {
      eventId: `${this.name}:${eventId}`,
      orderId,
      status: status as "PAID" | "FAILED",
      type: clean(payload.type) || `PAYMENT_${status}`,
      payload
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
