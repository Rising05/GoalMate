import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { RewardsController } from "./rewards.controller";
import { RewardsService } from "./rewards.service";
import { QuotaModule } from "../quota/quota.module";

@Module({
  imports: [AuthModule, PrismaModule, QuotaModule],
  controllers: [RewardsController],
  providers: [RewardsService]
})
export class RewardsModule {}
