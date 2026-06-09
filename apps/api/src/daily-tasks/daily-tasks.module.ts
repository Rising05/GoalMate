import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { DailyTasksController } from "./daily-tasks.controller";
import { DailyTasksService } from "./daily-tasks.service";

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [DailyTasksController],
  providers: [DailyTasksService]
})
export class DailyTasksModule {}
