import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { QueueModule } from "../queue/queue.module";
import { MAIL_PROVIDER } from "./mail-provider";
import { MockMailProvider } from "./mock-mail.provider";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { NotificationsWorker } from "./notifications.worker";

@Module({
  imports: [AuthModule, PrismaModule, QueueModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsWorker,
    MockMailProvider,
    {
      provide: MAIL_PROVIDER,
      useExisting: MockMailProvider
    }
  ]
})
export class NotificationsModule {}
