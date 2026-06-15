import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { QueueModule } from "../queue/queue.module";
import { DailyTasksController } from "./daily-tasks.controller";
import { DailyTasksService } from "./daily-tasks.service";
import { MockScoringProvider } from "./mock-scoring.provider";
import { SCORING_PROVIDER } from "./scoring-provider";

@Module({
  imports: [AuthModule, PrismaModule, QueueModule],
  controllers: [DailyTasksController],
  providers: [
    DailyTasksService,
    MockScoringProvider,
    {
      provide: SCORING_PROVIDER,
      useExisting: MockScoringProvider
    }
  ],
  exports: [DailyTasksService]
})
export class DailyTasksModule {}
