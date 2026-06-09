import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { DailyTasksModule } from "./daily-tasks/daily-tasks.module";
import { GoalsModule } from "./goals/goals.module";
import { HealthController } from "./health.controller";
import { PrismaModule } from "./prisma/prisma.module";

@Module({
  imports: [PrismaModule, AuthModule, GoalsModule, DailyTasksModule],
  controllers: [HealthController],
  providers: []
})
export class AppModule {}
