import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { GoalsModule } from "./goals/goals.module";
import { HealthController } from "./health.controller";
import { PrismaModule } from "./prisma/prisma.module";

@Module({
  imports: [PrismaModule, AuthModule, GoalsModule],
  controllers: [HealthController],
  providers: []
})
export class AppModule {}
