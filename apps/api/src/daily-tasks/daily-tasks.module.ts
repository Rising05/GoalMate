import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { QueueModule } from "../queue/queue.module";
import { DailyTasksController } from "./daily-tasks.controller";
import { DailyTasksService } from "./daily-tasks.service";
import { MockScoringProvider } from "./mock-scoring.provider";
import { SCORING_PROVIDER } from "./scoring-provider";
import { QuotaModule } from "../quota/quota.module";
import { DeepSeekScoringProvider } from "./deepseek-scoring.provider";

@Module({
  imports: [AuthModule, PrismaModule, QueueModule, QuotaModule],
  controllers: [DailyTasksController],
  providers: [
    DailyTasksService,
    MockScoringProvider,
    DeepSeekScoringProvider,
    {
      provide: SCORING_PROVIDER,
      inject: [MockScoringProvider, DeepSeekScoringProvider],
      useFactory: (mock: MockScoringProvider, deepseek: DeepSeekScoringProvider) =>
        process.env.AI_PROVIDER === "deepseek" && deepseek.isConfigured() ? deepseek : mock
    }
  ],
  exports: [DailyTasksService]
})
export class DailyTasksModule {}
