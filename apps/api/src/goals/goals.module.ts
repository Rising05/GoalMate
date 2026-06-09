import { Module } from "@nestjs/common";
import { AiJobsModule } from "../ai-jobs/ai-jobs.module";
import { AuthModule } from "../auth/auth.module";
import { GoalsController } from "./goals.controller";
import { GoalsService } from "./goals.service";

@Module({
  imports: [AuthModule, AiJobsModule],
  controllers: [GoalsController],
  providers: [GoalsService]
})
export class GoalsModule {}
