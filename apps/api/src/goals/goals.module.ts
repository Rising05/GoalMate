import { Module } from "@nestjs/common";
import { AiJobsModule } from "../ai-jobs/ai-jobs.module";
import { AuthModule } from "../auth/auth.module";
import { QueueModule } from "../queue/queue.module";
import { GoalsController } from "./goals.controller";
import { GoalsReportWorker } from "./goals.report.worker";
import { GoalsService } from "./goals.service";

@Module({
  imports: [AuthModule, AiJobsModule, QueueModule],
  controllers: [GoalsController],
  providers: [GoalsService, GoalsReportWorker]
})
export class GoalsModule {}
