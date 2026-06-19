import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { QuotaService } from "./quota.service";

@Module({
  imports: [PrismaModule],
  providers: [QuotaService],
  exports: [QuotaService]
})
export class QuotaModule {}
