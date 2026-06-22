import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { UploadsController } from "./uploads.controller";
import { UploadsService } from "./uploads.service";
import { LocalStorageProvider, STORAGE_PROVIDER } from "./storage-provider";
import { QuotaModule } from "../quota/quota.module";
import { QueueModule } from "../queue/queue.module";
import { S3StorageProvider } from "./s3-storage.provider";
import { ClamAvFileScanner, FILE_SCANNER, MockFileScanner } from "./file-scanner";
import { UploadsWorker } from "./uploads.worker";
import { UploadsCleanupScheduler } from "./uploads-cleanup.scheduler";

@Module({
  imports: [AuthModule, PrismaModule, QuotaModule, QueueModule],
  controllers: [UploadsController],
  providers: [
    UploadsService,
    UploadsWorker,
    UploadsCleanupScheduler,
    LocalStorageProvider,
    S3StorageProvider,
    MockFileScanner,
    ClamAvFileScanner,
    {
      provide: STORAGE_PROVIDER,
      inject: [LocalStorageProvider, S3StorageProvider],
      useFactory: (local: LocalStorageProvider, s3: S3StorageProvider) => {
        const selected = (process.env.UPLOAD_STORAGE_PROVIDER || "LOCAL").toUpperCase();
        if (process.env.NODE_ENV === "production" && selected === "LOCAL") {
          throw new Error("Local upload storage is forbidden in production");
        }
        if (selected === "S3") {
          s3.assertConfigured();
          return s3;
        }
        if (selected !== "LOCAL") throw new Error(`Unsupported upload storage provider: ${selected}`);
        return local;
      }
    },
    {
      provide: FILE_SCANNER,
      inject: [MockFileScanner, ClamAvFileScanner],
      useFactory: (mock: MockFileScanner, clamav: ClamAvFileScanner) => {
        const selected = (process.env.FILE_SCANNER_PROVIDER || "MOCK").toUpperCase();
        if (process.env.NODE_ENV === "production" && selected === "MOCK") {
          throw new Error("Mock file scanner is forbidden in production");
        }
        if (selected === "CLAMAV") return clamav;
        if (selected !== "MOCK") throw new Error(`Unsupported file scanner provider: ${selected}`);
        return mock;
      }
    }
  ],
  exports: [UploadsService, STORAGE_PROVIDER]
})
export class UploadsModule {}
