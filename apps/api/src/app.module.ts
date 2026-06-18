import { Module } from "@nestjs/common";
import { AdminModule } from "./admin/admin.module";
import { AuthModule } from "./auth/auth.module";
import { DailyTasksModule } from "./daily-tasks/daily-tasks.module";
import { GoalsModule } from "./goals/goals.module";
import { HealthController } from "./health.controller";
import { NotificationsModule } from "./notifications/notifications.module";
import { PrismaModule } from "./prisma/prisma.module";
import { QueueModule } from "./queue/queue.module";
import { RewardsModule } from "./rewards/rewards.module";
import { UploadsModule } from "./uploads/uploads.module";
import { BillingModule } from "./billing/billing.module";

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    GoalsModule,
    DailyTasksModule,
    RewardsModule,
    QueueModule,
    NotificationsModule,
    UploadsModule,
    BillingModule,
    AdminModule
  ],
  controllers: [HealthController],
  providers: []
})
export class AppModule {}
