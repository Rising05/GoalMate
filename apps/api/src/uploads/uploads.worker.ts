import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { QueueService } from "../queue/queue.service";
import { UploadsService } from "./uploads.service";

@Injectable()
export class UploadsWorker implements OnModuleInit {
  constructor(
    @Inject(QueueService) private readonly queues: QueueService,
    @Inject(UploadsService) private readonly uploads: UploadsService
  ) {}

  onModuleInit() {
    if (process.env.BULLMQ_WORKERS_ENABLED !== "true") return;
    this.queues.createWorker("uploads", async (data) => {
      if (data.type === "UPLOAD_CLEANUP") return this.uploads.cleanupUploadAssets();
      if (data.type === "OBJECT_DELETE") {
        const deletionJobId = typeof data.deletionJobId === "string" ? data.deletionJobId : "";
        if (!deletionJobId) throw new Error("Object deletion payload is missing deletionJobId");
        return this.uploads.processObjectDeletionJob(deletionJobId);
      }
      const uploadId = typeof data.uploadId === "string" ? data.uploadId : "";
      if (!uploadId) throw new Error("Upload worker payload is missing uploadId");
      if (data.type === "UPLOAD_SCAN") return this.uploads.processUploadScan(uploadId);
      if (data.type === "UPLOAD_DELETE") return this.uploads.processAssetDeletion(uploadId);
      throw new Error(`Unsupported upload job type: ${String(data.type)}`);
    });
  }
}
