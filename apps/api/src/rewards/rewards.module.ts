import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { RewardsController } from "./rewards.controller";
import { RewardsService } from "./rewards.service";

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [RewardsController],
  providers: [RewardsService]
})
export class RewardsModule {}
