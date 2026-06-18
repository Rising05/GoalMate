import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { UploadsController } from "./uploads.controller";
import { UploadsService } from "./uploads.service";
import { LocalStorageProvider, STORAGE_PROVIDER } from "./storage-provider";

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [UploadsController],
  providers: [
    UploadsService,
    LocalStorageProvider,
    { provide: STORAGE_PROVIDER, useExisting: LocalStorageProvider }
  ],
  exports: [UploadsService, STORAGE_PROVIDER]
})
export class UploadsModule {}
