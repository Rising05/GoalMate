import { Body, Controller, Get, Headers, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import { AuthenticatedRequest, AuthGuard } from "../auth/auth.guard";
import { BillingService } from "./billing.service";

@Controller("billing")
@UseGuards(AuthGuard)
export class BillingController {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}
  @Get("plans") listPlans() { return this.billing.listPlans(); }
  @Post("orders") createOrder(@Req() req: AuthenticatedRequest, @Body() body: unknown) { return this.billing.createOrder(req.user!.id, body); }
  @Get("orders") listOrders(@Req() req: AuthenticatedRequest) { return this.billing.listOrders(req.user!.id); }
}

@Controller("billing/webhooks")
export class BillingWebhookController {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}
  @Post(":provider") process(
    @Param("provider") provider: string,
    @Headers("x-payment-signature") signature: string | undefined,
    @Headers("stripe-signature") stripeSignature: string | undefined,
    @Headers("wechatpay-signature") wechatpaySignature: string | undefined,
    @Headers("wechatpay-timestamp") wechatpayTimestamp: string | undefined,
    @Headers("wechatpay-nonce") wechatpayNonce: string | undefined,
    @Headers("wechatpay-serial") wechatpaySerial: string | undefined,
    @Req() request: { rawBody?: Buffer | string },
    @Body() body: unknown
  ) {
    const normalizedProvider = provider.trim().toUpperCase();
    const needsRawBody = normalizedProvider === "STRIPE" || normalizedProvider === "WECHAT_PAY";
    const webhookBody = needsRawBody ? request.rawBody ?? body : body;
    const webhookSignature = normalizedProvider === "STRIPE"
      ? stripeSignature
      : normalizedProvider === "WECHAT_PAY"
        ? {
            signature: wechatpaySignature,
            timestamp: wechatpayTimestamp,
            nonce: wechatpayNonce,
            serial: wechatpaySerial
          }
        : signature;
    return this.billing.processWebhook(provider, webhookBody, webhookSignature);
  }
}
