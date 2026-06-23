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
    @Body() body: unknown
  ) { return this.billing.processWebhook(provider, body, signature); }
}
