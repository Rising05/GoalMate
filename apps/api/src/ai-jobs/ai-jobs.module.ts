import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { QueueModule } from "../queue/queue.module";
import { AiJobsController } from "./ai-jobs.controller";
import { AiJobsService } from "./ai-jobs.service";
import { AiJobsWorker } from "./ai-jobs.worker";
import { DeepSeekPlanProvider } from "./deepseek-plan.provider";
import { MockPlanProvider } from "./mock-plan.provider";
import { PLAN_PROVIDER } from "./plan-provider";

@Module({
  imports: [AuthModule, PrismaModule, QueueModule],
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
