import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { QueueModule } from "../queue/queue.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";

@Module({
  imports: [AuthModule, PrismaModule, QueueModule],
  controllers: [AdminController],
  providers: [AdminService]
})
export class AdminModule {}
