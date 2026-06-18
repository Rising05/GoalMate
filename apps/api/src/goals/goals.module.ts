import { forwardRef, Module } from "@nestjs/common";
import { AiJobsModule } from "../ai-jobs/ai-jobs.module";
import { AuthModule } from "../auth/auth.module";
import { QueueModule } from "../queue/queue.module";
import { DeepSeekReportNarrativeProvider } from "./deepseek-report-narrative.provider";
import { GoalsController } from "./goals.controller";
import { GoalsReportWorker } from "./goals.report.worker";
import { GoalsService } from "./goals.service";
import { MockReportNarrativeProvider } from "./mock-report-narrative.provider";
import { REPORT_NARRATIVE_PROVIDER } from "./report-narrative.provider";

@Module({
  imports: [AuthModule, forwardRef(() => AiJobsModule), QueueModule],
  controllers: [GoalsController],
  providers: [
    GoalsService,
    GoalsReportWorker,
    MockReportNarrativeProvider,
    DeepSeekReportNarrativeProvider,
    {
      provide: REPORT_NARRATIVE_PROVIDER,
      inject: [MockReportNarrativeProvider, DeepSeekReportNarrativeProvider],
      useFactory: (
        mockProvider: MockReportNarrativeProvider,
        deepSeekProvider: DeepSeekReportNarrativeProvider
      ) => {
        if (
          process.env.AI_PROVIDER === "deepseek" &&
          deepSeekProvider.isConfigured()
        ) {
          return deepSeekProvider;
        }

        return mockProvider;
      }
    }
  ],
  exports: [GoalsService]
})
export class GoalsModule {}
