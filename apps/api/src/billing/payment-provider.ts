import { BadRequestException, Injectable } from "@nestjs/common";
import { createDecipheriv, createHmac, createSign, createVerify, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
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

export interface PaymentWebhookHeaders {
  signature?: string;
  timestamp?: string;
  nonce?: string;
  serial?: string;
}

export interface PaymentProvider {
  readonly name: string;
  isConfigured(): boolean;
  createCheckout(input: PaymentCheckoutInput): Promise<{
    providerOrderId: string;
    checkoutUrl: string;
  }>;
  parseWebhook(input: unknown, signature?: string | PaymentWebhookHeaders): ParsedPaymentEvent;
}

type StripeClient = Pick<Stripe, "checkout" | "webhooks">;

interface StripeProviderConfig {
  secretKey: string;
  webhookSecret: string;
  successUrl: string;
  cancelUrl: string;
}

interface WechatPayConfig {
  mchId: string;
  appId: string;
  merchantSerialNo: string;
  merchantPrivateKey: string;
  apiV3Key: string;
  notifyUrl: string;
  apiBaseUrl: string;
  tradeType: "NATIVE" | "JSAPI";
  openId: string;
  platformPublicKey: string;
}

type FetchLike = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body?: string;
}) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

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

  parseWebhook(input: unknown, signature?: string | PaymentWebhookHeaders): ParsedPaymentEvent {
    if (typeof signature !== "string") {
      throw new BadRequestException("支付回调签名无效");
    }
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

  parseWebhook(input: unknown, signature?: string | PaymentWebhookHeaders): ParsedPaymentEvent {
    if (typeof signature !== "string") {
      throw new BadRequestException("Stripe 回调签名缺失");
    }
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
export class WechatPayProvider implements PaymentProvider {
  readonly name = "WECHAT_PAY";
  constructor(
    private readonly fetcher: FetchLike = fetch as FetchLike,
    private readonly config: Partial<WechatPayConfig> = {}
  ) {}

  isConfigured() {
    return Boolean(
      this.getMchId() &&
      this.getAppId() &&
      this.getMerchantSerialNo() &&
      this.getMerchantPrivateKey() &&
      this.getApiV3Key() &&
      this.getNotifyUrl() &&
      this.getPlatformPublicKey() &&
      (this.getTradeType() !== "JSAPI" || this.getOpenId())
    );
  }

  async createCheckout(input: PaymentCheckoutInput) {
    const tradeType = this.getTradeType();
    const path = tradeType === "JSAPI" ? "/v3/pay/transactions/jsapi" : "/v3/pay/transactions/native";
    const body = {
      appid: this.getAppId(),
      mchid: this.getMchId(),
      description: input.description,
      out_trade_no: input.orderId,
      notify_url: this.getNotifyUrl(),
      amount: {
        total: input.amountCents,
        currency: input.currency
      },
      ...(tradeType === "JSAPI" ? { payer: { openid: this.getOpenId() } } : {})
    };
    const bodyText = JSON.stringify(body);
    const url = `${this.getApiBaseUrl()}${path}`;
    const response = await this.fetcher(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: this.createAuthorizationHeader("POST", path, bodyText)
      },
      body: bodyText
    });

    if (!response.ok) {
      const text = await response.text();
      throw new BadRequestException(`微信支付下单失败：${text || response.status}`);
    }

    const value = await response.json();
    const payload = value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    const codeUrl = clean(payload.code_url);
    const prepayId = clean(payload.prepay_id);
    const checkoutUrl = tradeType === "NATIVE" ? codeUrl : prepayId ? `wechatpay://jsapi?prepay_id=${encodeURIComponent(prepayId)}` : "";

    if (!checkoutUrl) {
      throw new BadRequestException("微信支付下单未返回支付参数");
    }

    return {
      providerOrderId: prepayId || input.orderId,
      checkoutUrl
    };
  }

  parseWebhook(input: unknown, signature?: string | PaymentWebhookHeaders): ParsedPaymentEvent {
    if (!signature || typeof signature === "string") {
      throw new BadRequestException("微信支付回调签名缺失");
    }

    const rawBody = typeof input === "string" || Buffer.isBuffer(input) ? input.toString("utf8") : "";
    if (!rawBody) {
      throw new BadRequestException("微信支付回调必须使用原始请求体验签");
    }

    const timestamp = clean(signature.timestamp);
    const nonce = clean(signature.nonce);
    const serial = clean(signature.serial);
    const signed = cleanSignature(signature.signature);
    if (!timestamp || !nonce || !serial || !signed) {
      throw new BadRequestException("微信支付回调签名参数不完整");
    }

    this.verifyWechatpaySignature(timestamp, nonce, rawBody, signed);

    const body = parseJsonObject(rawBody, "微信支付回调 JSON 无效");
    const resource = body.resource && typeof body.resource === "object" && !Array.isArray(body.resource)
      ? body.resource as Record<string, unknown>
      : null;
    if (!resource) {
      throw new BadRequestException("微信支付回调缺少加密资源");
    }

    const decrypted = parseJsonObject(this.decryptResource(resource), "微信支付回调资源 JSON 无效");
    const eventType = clean(body.event_type);
    const status = mapWechatEventStatus(eventType, decrypted);
    const orderId = clean(decrypted.out_trade_no);
    if (!orderId) {
      throw new BadRequestException("微信支付回调缺少本地订单标识");
    }

    const amount = decrypted.amount && typeof decrypted.amount === "object" && !Array.isArray(decrypted.amount)
      ? decrypted.amount as Record<string, unknown>
      : {};
    const providerPaymentId = clean(decrypted.transaction_id) || clean(decrypted.refund_id) || clean(body.id);
    const amountCents = status === "REFUNDED"
      ? parseOptionalInteger(amount.refund)
      : parseOptionalInteger(amount.total);

    return {
      eventId: `WECHAT_PAY:${clean(body.id)}`,
      orderId,
      status,
      type: eventType || "WECHAT_PAY_NOTIFY",
      amountCents,
      providerPaymentId,
      providerSubscriptionId: null,
      reason: clean(decrypted.trade_state_desc) || clean(decrypted.refund_status) || null,
      payload: {
        eventId: clean(body.id),
        orderId,
        status,
        type: eventType || "WECHAT_PAY_NOTIFY",
        amountCents: amountCents ?? null,
        providerPaymentId,
        providerSubscriptionId: null,
        hasReason: Boolean(clean(decrypted.trade_state_desc) || clean(decrypted.refund_status)),
        platformSerial: serial
      }
    };
  }

  private createAuthorizationHeader(method: string, path: string, body: string) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomBytes(16).toString("hex");
    const message = `${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`;
    const signature = createSign("RSA-SHA256")
      .update(message)
      .sign(normalizePem(this.getMerchantPrivateKey()), "base64");

    return `WECHATPAY2-SHA256-RSA2048 mchid="${this.getMchId()}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${this.getMerchantSerialNo()}"`;
  }

  private verifyWechatpaySignature(timestamp: string, nonce: string, rawBody: string, signature: string) {
    const message = `${timestamp}\n${nonce}\n${rawBody}\n`;
    const valid = createVerify("RSA-SHA256")
      .update(message)
      .verify(normalizePem(this.getPlatformPublicKey()), signature, "base64");
    if (!valid) {
      throw new BadRequestException("微信支付回调签名无效");
    }
  }

  private decryptResource(resource: Record<string, unknown>) {
    const ciphertext = cleanUnbounded(resource.ciphertext);
    const nonce = clean(resource.nonce);
    const associatedData = clean(resource.associated_data);
    if (!ciphertext || !nonce) {
      throw new BadRequestException("微信支付回调加密资源不完整");
    }

    try {
      const encrypted = Buffer.from(ciphertext, "base64");
      const authTag = encrypted.subarray(encrypted.length - 16);
      const data = encrypted.subarray(0, encrypted.length - 16);
      const decipher = createDecipheriv("aes-256-gcm", Buffer.from(this.getApiV3Key(), "utf8"), Buffer.from(nonce, "utf8"));
      decipher.setAuthTag(authTag);
      if (associatedData) {
        decipher.setAAD(Buffer.from(associatedData, "utf8"));
      }
      return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    } catch {
      throw new BadRequestException("微信支付回调资源解密失败");
    }
  }

  private getMchId() {
    return this.config.mchId ?? process.env.WECHAT_PAY_MCH_ID ?? "";
  }

  private getAppId() {
    return this.config.appId ?? process.env.WECHAT_PAY_APP_ID ?? "";
  }

  private getMerchantSerialNo() {
    return this.config.merchantSerialNo ?? process.env.WECHAT_PAY_MERCHANT_SERIAL_NO ?? "";
  }

  private getMerchantPrivateKey() {
    return this.config.merchantPrivateKey ?? process.env.WECHAT_PAY_MERCHANT_PRIVATE_KEY ?? "";
  }

  private getApiV3Key() {
    return this.config.apiV3Key ?? process.env.WECHAT_PAY_API_V3_KEY ?? "";
  }

  private getNotifyUrl() {
    return this.config.notifyUrl ?? process.env.WECHAT_PAY_NOTIFY_URL ?? "";
  }

  private getApiBaseUrl() {
    return (this.config.apiBaseUrl ?? process.env.WECHAT_PAY_API_BASE_URL ?? "https://api.mch.weixin.qq.com").replace(/\/$/, "");
  }

  private getTradeType() {
    const value = (this.config.tradeType ?? process.env.WECHAT_PAY_TRADE_TYPE ?? "NATIVE").toUpperCase();
    return value === "JSAPI" ? "JSAPI" : "NATIVE";
  }

  private getOpenId() {
    return this.config.openId ?? process.env.WECHAT_PAY_OPEN_ID ?? "";
  }

  private getPlatformPublicKey() {
    return this.config.platformPublicKey ?? process.env.WECHAT_PAY_PLATFORM_PUBLIC_KEY ?? "";
  }
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 200) : "";
}

function cleanUnbounded(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseOptionalInteger(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue >= 0 ? numberValue : undefined;
}

function parseJsonObject(value: string, message: string) {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // handled below
  }
  throw new BadRequestException(message);
}

function cleanSignature(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePem(value: string) {
  return value.replace(/\\n/g, "\n");
}

function mapWechatEventStatus(eventType: string, resource: Record<string, unknown>): ParsedPaymentEvent["status"] {
  if (eventType.includes("REFUND")) {
    const refundStatus = clean(resource.refund_status).toUpperCase();
    return refundStatus === "SUCCESS" ? "REFUNDED" : "FAILED";
  }

  const tradeState = clean(resource.trade_state).toUpperCase();
  if (tradeState === "SUCCESS") return "PAID";
  if (tradeState === "REFUND") return "REFUNDED";
  if (tradeState === "CLOSED" || tradeState === "REVOKED") return "CANCELED";
  return "FAILED";
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
