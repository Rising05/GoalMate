import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { GrowthEventsController } from "./growth-events.controller";
import { GrowthEventsService } from "./growth-events.service";

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [GrowthEventsController],
  providers: [GrowthEventsService],
  exports: [GrowthEventsService]
})
export class GrowthEventsModule {}
