import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
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
import { QuotaModule } from "./quota/quota.module";
import { AiModule } from "./ai/ai.module";
import { ObservabilityModule } from "./observability/observability.module";
import { RequestTracingMiddleware } from "./observability/request-tracing.middleware";

@Module({
  imports: [
    PrismaModule,
    AiModule,
    ObservabilityModule,
    AuthModule,
    GoalsModule,
    DailyTasksModule,
    RewardsModule,
    QueueModule,
    NotificationsModule,
    UploadsModule,
    BillingModule,
    QuotaModule,
    AdminModule
  ],
  controllers: [HealthController],
  providers: []
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestTracingMiddleware).forRoutes("*");
  }
}
