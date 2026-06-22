import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { UploadsService } from "./uploads.service";
import { QueueService } from "../queue/queue.service";

@Injectable()
export class UploadsCleanupScheduler implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  constructor(
    @Inject(UploadsService) private readonly uploads: UploadsService,
    @Inject(QueueService) private readonly queues: QueueService
  ) {}

  onModuleInit() {
    if (process.env.UPLOAD_CLEANUP_ENABLED !== "true") return;
    const intervalMs = Math.max(60_000, Number(process.env.UPLOAD_CLEANUP_INTERVAL_MS || 3_600_000));
    this.timer = setInterval(() => void this.enqueueCleanup().catch((error) => {
      process.stderr.write(`${JSON.stringify({ level: "error", event: "upload_cleanup_failed", errorType: error instanceof Error ? error.constructor.name : "UnknownError", timestamp: new Date().toISOString() })}\n`);
    }), intervalMs);
    this.timer.unref();
  }

  private async enqueueCleanup() {
    if (this.queues.isEnabled()) {
      const interval = Math.max(60_000, Number(process.env.UPLOAD_CLEANUP_INTERVAL_MS || 3_600_000));
      return this.queues.enqueueUploadCleanup(String(Math.floor(Date.now() / interval)));
    }
    return this.uploads.cleanupUploadAssets();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
