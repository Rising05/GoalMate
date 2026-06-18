import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { QueueModule } from "../queue/queue.module";
import { MAIL_PROVIDER } from "./mail-provider";
import { MockMailProvider } from "./mock-mail.provider";
import { MockWechatProvider } from "./mock-wechat.provider";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { NotificationsWorker } from "./notifications.worker";
import { ResendMailProvider } from "./resend-mail.provider";
import { WECHAT_PROVIDER } from "./wechat-provider";
import { WechatSubscribeProvider } from "./wechat-subscribe.provider";

@Module({
  imports: [AuthModule, PrismaModule, QueueModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsWorker,
    MockMailProvider,
    ResendMailProvider,
    MockWechatProvider,
    WechatSubscribeProvider,
    {
      provide: MAIL_PROVIDER,
      inject: [MockMailProvider, ResendMailProvider],
      useFactory: (
        mockProvider: MockMailProvider,
        resendProvider: ResendMailProvider
      ) =>
        process.env.MAIL_PROVIDER === "resend" && resendProvider.isConfigured()
          ? resendProvider
          : mockProvider
    },
    {
      provide: WECHAT_PROVIDER,
      inject: [MockWechatProvider, WechatSubscribeProvider],
      useFactory: (
        mockProvider: MockWechatProvider,
        wechatProvider: WechatSubscribeProvider
      ) =>
        process.env.WECHAT_PROVIDER === "wechat" && wechatProvider.isConfigured()
          ? wechatProvider
          : mockProvider
    }
  ]
})
export class NotificationsModule {}
