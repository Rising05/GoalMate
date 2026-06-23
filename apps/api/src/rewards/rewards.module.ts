import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { RewardsController } from "./rewards.controller";
import { RewardsService } from "./rewards.service";
import { QuotaModule } from "../quota/quota.module";
import { SecurityModule } from "../security/security.module";

@Module({
  imports: [AuthModule, PrismaModule, QuotaModule, SecurityModule],
  controllers: [RewardsController],
  providers: [RewardsService]
})
export class RewardsModule {}
