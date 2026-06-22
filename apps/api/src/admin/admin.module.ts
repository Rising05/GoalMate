import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { QueueModule } from "../queue/queue.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { UploadsModule } from "../uploads/uploads.module";

@Module({
  imports: [AuthModule, PrismaModule, QueueModule, NotificationsModule, UploadsModule],
  controllers: [AdminController],
  providers: [AdminService]
})
export class AdminModule {}
