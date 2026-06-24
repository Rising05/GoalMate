import { forwardRef, Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DailyTasksModule } from "../daily-tasks/daily-tasks.module";
import { GoalsModule } from "../goals/goals.module";
import { PrismaModule } from "../prisma/prisma.module";
import { QueueModule } from "../queue/queue.module";
import { AiJobsController } from "./ai-jobs.controller";
import { AiJobsService } from "./ai-jobs.service";
import { AiJobsWorker } from "./ai-jobs.worker";
import { DeepSeekPlanProvider } from "./deepseek-plan.provider";
import { MockPlanProvider } from "./mock-plan.provider";
import { PLAN_PROVIDER } from "./plan-provider";
import { QuotaModule } from "../quota/quota.module";
import { SecurityModule } from "../security/security.module";
import { GrowthEventsModule } from "../growth-events/growth-events.module";

@Module({
  imports: [
    AuthModule,
    PrismaModule,
    QueueModule,
    DailyTasksModule,
    QuotaModule,
    SecurityModule,
    GrowthEventsModule,
    forwardRef(() => GoalsModule)
  ],
  controllers: [AiJobsController],
  providers: [
    AiJobsService,
    AiJobsWorker,
    MockPlanProvider,
    DeepSeekPlanProvider,
    {
      provide: PLAN_PROVIDER,
      inject: [MockPlanProvider, DeepSeekPlanProvider],
      useFactory: (
        mockPlanProvider: MockPlanProvider,
        deepSeekPlanProvider: DeepSeekPlanProvider
      ) => {
        if (
          process.env.AI_PROVIDER === "deepseek" &&
          deepSeekPlanProvider.isConfigured()
        ) {
          return deepSeekPlanProvider;
        }

        return mockPlanProvider;
      }
    }
  ],
  exports: [AiJobsService]
})
export class AiJobsModule {}
