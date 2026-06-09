import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { AiJobsService } from "./ai-jobs.service";
import { MockPlanProvider } from "./mock-plan.provider";

@Module({
  imports: [PrismaModule],
  providers: [AiJobsService, MockPlanProvider],
  exports: [AiJobsService]
})
export class AiJobsModule {}
