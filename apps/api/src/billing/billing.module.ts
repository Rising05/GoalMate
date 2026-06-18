import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { BillingController, BillingWebhookController } from "./billing.controller";
import { BillingService } from "./billing.service";
import { MockPaymentProvider, PAYMENT_PROVIDERS, StripePaymentProvider, WechatPayProvider } from "./payment-provider";

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [BillingController, BillingWebhookController],
  providers: [
    BillingService, MockPaymentProvider, StripePaymentProvider, WechatPayProvider,
    {
      provide: PAYMENT_PROVIDERS,
      inject: [MockPaymentProvider, StripePaymentProvider, WechatPayProvider],
      useFactory: (...providers: [MockPaymentProvider, StripePaymentProvider, WechatPayProvider]) => providers
    }
  ],
  exports: [BillingService]
})
export class BillingModule {}
