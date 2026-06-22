import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional
} from "@nestjs/common";
import { Prisma, UploadAsset } from "@prisma/client";
import { fileTypeFromBuffer } from "file-type";
import { imageSize } from "image-size";
import { PDFDocument } from "pdf-lib";
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { QuotaService } from "../quota/quota.service";
import { QueueService } from "../queue/queue.service";
import { ObjectDeletionService } from "../object-lifecycle/object-deletion.service";
import { FILE_SCANNER, FileScanner, MockFileScanner } from "./file-scanner";
import {
  LocalStorageProvider,
  STORAGE_PROVIDER,
  StorageProvider
} from "./storage-provider";

const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf"
]);
const ALLOWED_SOURCES = new Set(["WEB", "WECHAT"]);
const ALLOWED_PURPOSES = new Set(["CHECKIN_EVIDENCE", "ERROR_NOTE", "STUDY_NOTE"]);
const UPLOAD_SCAN_JOB = "UPLOAD_SCAN";
const UPLOAD_DELETE_JOB = "UPLOAD_DELETE";

@Injectable()
export class UploadsService implements OnModuleInit {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(STORAGE_PROVIDER)
    private readonly storage: StorageProvider = new LocalStorageProvider(),
    @Optional()
    @Inject(QuotaService)
    private readonly quotaService: QuotaService = new QuotaService(prisma),
    @Optional()
    @Inject(FILE_SCANNER)
    private readonly scanner: FileScanner = new MockFileScanner(),
    @Optional()
    @Inject(QueueService)
    private readonly queueService?: QueueService,
    @Optional()
    @Inject(ObjectDeletionService)
    private readonly objectDeletions: ObjectDeletionService = new ObjectDeletionService(prisma)
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === "production") {
      if (!this.storage.supportsDirectUpload) throw new Error("Production uploads require direct object storage");
      if (process.env.UPLOAD_SCAN_ASYNC !== "true" || !this.queueService?.isEnabled()) {
        throw new Error("Production uploads require asynchronous scanning with BullMQ enabled");
      }
      if (process.env.UPLOAD_CLEANUP_ENABLED !== "true") {
        throw new Error("Production uploads require the cleanup scheduler");
      }
    }
  }

  async createEvidenceUpload(userId: string, input: unknown) {
    const payload = this.parseUploadPayload(input);
    if (payload.goalId) {
      const ownedGoal = await this.prisma.goal.count({ where: { id: payload.goalId, userId } });
      if (!ownedGoal) throw new BadRequestException("上传关联目标不存在或不属于当前用户");
    }
    const assetId = randomUUID();
    const ttlSeconds = this.getUploadTtlSeconds();
    const createAsset = (client: PrismaService | Prisma.TransactionClient) =>
      client.uploadAsset.create({ data: {
        id: assetId,
        userId,
        goalId: payload.goalId,
        source: payload.source,
        purpose: payload.purpose,
        fileName: payload.fileName,
        mimeType: payload.mimeType,
        sizeBytes: payload.sizeBytes,
        checksumSha256: payload.checksumSha256,
        storageProvider: this.storage.name,
        objectKey: this.buildObjectKey(userId),
        publicUrl: null,
        status: "PENDING_UPLOAD",
        scanStatus: "PENDING",
        uploadExpiresAt: new Date(Date.now() + ttlSeconds * 1000),
        metadata: payload.metadata
      } });
    if (this.storage.supportsDirectUpload && !payload.checksumSha256) {
      throw new BadRequestException("云存储直传必须提供 SHA-256 校验值");
    }
    const asset = await this.quotaService.runWithQuota(
          userId,
          "UPLOAD_STORAGE_KIB",
          {
            idempotencyKey: `upload-storage:${assetId}`,
            quantity: Math.ceil(payload.sizeBytes / 1024),
            resourceType: "UPLOAD_ASSET",
            resourceId: assetId,
            metadata: { sizeBytes: payload.sizeBytes }
          },
          createAsset
        );

    return {
      asset: this.serializeUploadAsset(asset),
      evidenceFile: this.toEvidenceFile(asset),
      upload: await this.buildUploadRequest(asset)
    };
  }

  async getEvidenceUpload(userId: string, uploadId: string) {
    const asset = await this.prisma.uploadAsset.findFirst({
      where: {
        id: uploadId,
        userId
      }
    });

    if (!asset) {
      throw new NotFoundException("上传证据不存在");
    }

    return {
      asset: this.serializeUploadAsset(asset),
      evidenceFile: this.toEvidenceFile(asset),
      download: asset.status === "READY" && asset.scanStatus === "CLEAN"
        ? await this.buildDownloadRequest(asset)
        : null
    };
  }

  async storeEvidenceContent(
    userId: string,
    uploadId: string,
    expires: string,
    signature: string,
    contentType: string | undefined,
    content: Buffer
  ) {
    const asset = await this.getOwnedAsset(userId, uploadId);
    this.assertSignature(asset, "upload", expires, signature);

    if (this.storage.supportsDirectUpload) {
      throw new BadRequestException("云存储资产必须使用预签名地址直传");
    }

    if (asset.status !== "PENDING_UPLOAD") {
      throw new BadRequestException("上传资产当前不可写入");
    }

    if (content.length !== asset.sizeBytes) {
      throw new BadRequestException("实际文件大小与声明不一致");
    }

    if ((contentType ?? "").split(";")[0].trim().toLowerCase() !== asset.mimeType) {
      throw new BadRequestException("实际文件类型与声明不一致");
    }

    await this.storage.put(asset.objectKey, content);
    return this.completeEvidenceUpload(userId, uploadId);
  }

  async completeEvidenceUpload(userId: string, uploadId: string) {
    const asset = await this.getOwnedAsset(userId, uploadId);
    if (asset.status === "READY" && asset.scanStatus === "CLEAN") {
      return {
        asset: this.serializeUploadAsset(asset),
        evidenceFile: this.toEvidenceFile(asset),
        download: await this.buildDownloadRequest(asset),
        queue: null
      };
    }
    if (!["PENDING_UPLOAD", "UPLOADED", "SCAN_FAILED"].includes(asset.status)) {
      throw new BadRequestException("上传资产当前不能完成");
    }
    if (asset.status === "PENDING_UPLOAD" && asset.uploadExpiresAt && asset.uploadExpiresAt < new Date()) {
      throw new BadRequestException("上传会话已过期，请重新创建");
    }
    let uploaded = asset;
    if (asset.status === "PENDING_UPLOAD") {
      const metadata = await this.storage.inspect(asset.objectKey);
      if (!metadata) throw new BadRequestException("对象存储中尚未找到上传文件");
      let content: Buffer;
      try {
        content = await this.storage.get(asset.objectKey);
        const verified = await this.verifyUploadedContent(asset, metadata, content);
        uploaded = await this.prisma.uploadAsset.update({
          where: { id: asset.id },
          data: {
            checksumSha256: verified.checksumSha256,
            verifiedMimeType: verified.mimeType,
            verifiedSizeBytes: verified.sizeBytes,
            status: "UPLOADED",
            scanStatus: "PENDING",
            scanResult: null,
            uploadedAt: new Date()
          }
        });
      } catch (error) {
        await this.rejectAsset(asset, error instanceof Error ? error.message : "Upload verification failed");
        throw error instanceof BadRequestException ? error : new BadRequestException("上传文件安全校验失败");
      }
    }

    if (this.shouldQueueScan()) {
      const queue = await this.queueService?.enqueueUploadJob({ uploadId: uploaded.id, userId, type: UPLOAD_SCAN_JOB });
      if (!queue?.queued) {
        const failed = await this.prisma.uploadAsset.update({ where: { id: uploaded.id }, data: { status: "SCAN_FAILED", scanStatus: "FAILED", scanResult: queue?.reason ?? "Upload scan queue is unavailable" } });
        return { asset: this.serializeUploadAsset(failed), evidenceFile: this.toEvidenceFile(failed), download: null, queue: queue ?? null };
      }
      return { asset: this.serializeUploadAsset(uploaded), evidenceFile: this.toEvidenceFile(uploaded), download: null, queue };
    }

    return this.processUploadScan(uploaded.id);
  }

  async processUploadScan(uploadId: string) {
    const asset = await this.prisma.uploadAsset.findUnique({ where: { id: uploadId } });
    if (!asset) throw new NotFoundException("上传资产不存在");
    if (asset.status === "READY" || asset.status === "QUARANTINED") {
      return { asset: this.serializeUploadAsset(asset), evidenceFile: this.toEvidenceFile(asset), download: asset.status === "READY" ? await this.buildDownloadRequest(asset) : null, processed: false };
    }
    if (!["UPLOADED", "SCAN_FAILED"].includes(asset.status)) throw new BadRequestException("上传资产当前不能扫描");
    await this.prisma.uploadAsset.update({ where: { id: asset.id }, data: { status: "SCANNING", scanStatus: "SCANNING", scanAttempts: { increment: 1 }, scanStartedAt: new Date(), scanResult: null } });
    try {
      const content = await this.storage.get(asset.objectKey);
      const result = await this.scanner.scan(content);
      const completed = await this.prisma.uploadAsset.update({
        where: { id: asset.id },
        data: result.clean
          ? { status: "READY", scanStatus: "CLEAN", scanResult: `${this.scanner.name}: ${result.message}`, scanCompletedAt: new Date() }
          : { status: "QUARANTINED", scanStatus: "INFECTED", scanResult: `${this.scanner.name}: ${result.signature ?? "malware"}`, scanCompletedAt: new Date() }
      });
      return { asset: this.serializeUploadAsset(completed), evidenceFile: this.toEvidenceFile(completed), download: result.clean ? await this.buildDownloadRequest(completed) : null, processed: true };
    } catch (error) {
      const failed = await this.prisma.uploadAsset.update({ where: { id: asset.id }, data: { status: "SCAN_FAILED", scanStatus: "FAILED", scanResult: error instanceof Error ? error.message.slice(0, 2000) : "Scanner failed", scanCompletedAt: new Date() } });
      throw Object.assign(error instanceof Error ? error : new Error("Scanner failed"), { asset: this.serializeUploadAsset(failed) });
    }
  }

  async readEvidenceContent(
    userId: string,
    uploadId: string,
    expires: string,
    signature: string
  ) {
    const asset = await this.getOwnedAsset(userId, uploadId);
    this.assertSignature(asset, "download", expires, signature);

    if (asset.status !== "READY" || asset.scanStatus !== "CLEAN" || asset.publicUrl) {
      throw new NotFoundException("上传证据内容不存在");
    }

    return {
      asset,
      content: await this.storage.get(asset.objectKey)
    };
  }

  async deleteEvidenceUpload(userId: string, uploadId: string) {
    const asset = await this.getOwnedAsset(userId, uploadId);
    const pending = await this.prisma.uploadAsset.update({ where: { id: asset.id }, data: { status: "DELETION_PENDING", deleteError: null } });
    if (this.shouldQueueScan()) {
      const queue = await this.queueService?.enqueueUploadJob({ uploadId: asset.id, userId, type: UPLOAD_DELETE_JOB });
      return { asset: this.serializeUploadAsset(pending), queue: queue ?? null };
    }
    return this.processAssetDeletion(asset.id);
  }

  private async getOwnedAsset(userId: string, uploadId: string) {
    const asset = await this.prisma.uploadAsset.findFirst({
      where: { id: uploadId, userId, status: { not: "DELETED" } }
    });

    if (!asset) {
      throw new NotFoundException("上传证据不存在");
    }

    return asset;
  }

  async processAssetDeletion(uploadId: string) {
    const asset = await this.prisma.uploadAsset.findUnique({ where: { id: uploadId } });
    if (!asset) throw new NotFoundException("上传资产不存在");
    if (asset.status === "DELETED" || asset.status === "EXPIRED") return { asset: this.serializeUploadAsset(asset), processed: false };
    await this.prisma.uploadAsset.update({ where: { id: asset.id }, data: { deleteAttempts: { increment: 1 }, lastDeleteAttemptAt: new Date() } });
    try {
      await this.objectDeletions.schedule([asset], "UPLOAD_ASSET", asset.id);
      const objectKeyHash = createHash("sha256").update(asset.objectKey).digest("hex");
      const deletionJob = await this.prisma.objectDeletionJob.findUniqueOrThrow({ where: { storageProvider_objectKeyHash: { storageProvider: asset.storageProvider, objectKeyHash } } });
      await this.processObjectDeletionJob(deletionJob.id);
      const deleted = await this.prisma.$transaction(async (tx) => {
        const result = await tx.uploadAsset.update({ where: { id: asset.id }, data: { status: "DELETED", deletedAt: new Date(), deleteError: null } });
        await this.quotaService.releaseWithClient(tx, asset.userId, "UPLOAD_STORAGE_KIB", "UPLOAD_ASSET", asset.id);
        return result;
      });
      return { asset: this.serializeUploadAsset(deleted), processed: true };
    } catch (error) {
      await this.prisma.uploadAsset.update({ where: { id: asset.id }, data: { status: "DELETE_FAILED", deleteError: error instanceof Error ? error.message.slice(0, 2000) : "Object deletion failed" } });
      throw error;
    }
  }

  async processObjectDeletionJob(jobId: string) {
    const job = await this.prisma.objectDeletionJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException("对象删除任务不存在");
    if (job.status === "SUCCEEDED") return { job, processed: false };
    if (!job.objectKey) throw new Error("Object deletion job has no object key");
    const running = await this.prisma.objectDeletionJob.update({ where: { id: job.id }, data: { status: "RUNNING", attempts: { increment: 1 }, error: null } });
    try {
      if (running.storageProvider !== this.storage.name) throw new Error(`Storage provider ${running.storageProvider} is not active`);
      await this.storage.delete(running.objectKey!);
      const completed = await this.prisma.objectDeletionJob.update({ where: { id: running.id }, data: { status: "SUCCEEDED", objectKey: null, completedAt: new Date(), error: null } });
      return { job: completed, processed: true };
    } catch (error) {
      await this.prisma.objectDeletionJob.update({ where: { id: running.id }, data: { status: "FAILED", error: error instanceof Error ? error.message.slice(0, 2000) : "Object deletion failed" } });
      throw error;
    }
  }

  async cleanupUploadAssets(input: { userId?: string } = {}) {
    const now = new Date();
    const scanRetryCutoff = new Date(Date.now() - Math.max(30_000, Number(process.env.UPLOAD_SCAN_RETRY_GRACE_MS || 300_000)));
    const expired = await this.prisma.uploadAsset.findMany({ where: { userId: input.userId, status: "PENDING_UPLOAD", uploadExpiresAt: { lt: now } }, take: 100 });
    const deletions = await this.prisma.uploadAsset.findMany({ where: { userId: input.userId, status: { in: ["DELETION_PENDING", "DELETE_FAILED"] } }, take: 100 });
    const pendingScans = await this.prisma.uploadAsset.findMany({ where: { userId: input.userId, status: { in: ["UPLOADED", "SCAN_FAILED"] }, scanAttempts: { lt: 3 }, updatedAt: { lt: scanRetryCutoff } }, take: 100 });
    const staleScans = await this.prisma.uploadAsset.updateMany({ where: { userId: input.userId, status: "SCANNING", scanStartedAt: { lt: scanRetryCutoff } }, data: { status: "SCAN_FAILED", scanStatus: "FAILED", scanResult: "Scan worker lease expired" } });
    const quarantineCutoff = new Date(Date.now() - Math.max(86_400_000, Number(process.env.UPLOAD_QUARANTINE_RETENTION_MS || 604_800_000)));
    const quarantined = await this.prisma.uploadAsset.findMany({ where: { userId: input.userId, status: "QUARANTINED", scanCompletedAt: { lt: quarantineCutoff } }, take: 100 });
    const objectDeletionJobs = await this.prisma.objectDeletionJob.findMany({ where: { status: { in: ["QUEUED", "FAILED"] }, attempts: { lt: 5 } }, orderBy: { createdAt: "asc" }, take: 100 });
    let expiredCount = 0;
    for (const asset of expired) {
      try {
        await this.objectDeletions.schedule([asset], "EXPIRED_UPLOAD", asset.id);
        const objectKeyHash = createHash("sha256").update(asset.objectKey).digest("hex");
        const job = await this.prisma.objectDeletionJob.findUniqueOrThrow({ where: { storageProvider_objectKeyHash: { storageProvider: asset.storageProvider, objectKeyHash } } });
        await this.processObjectDeletionJob(job.id);
      } catch {}
      await this.prisma.$transaction(async (tx) => {
        await tx.uploadAsset.update({ where: { id: asset.id }, data: { status: "EXPIRED", deletedAt: now } });
        await this.quotaService.releaseWithClient(tx, asset.userId, "UPLOAD_STORAGE_KIB", "UPLOAD_ASSET", asset.id);
      });
      expiredCount += 1;
    }
    let deletedCount = 0;
    for (const asset of deletions) {
      try { await this.processAssetDeletion(asset.id); deletedCount += 1; } catch {}
    }
    let scansRequeued = 0;
    for (const asset of pendingScans) {
      try {
        if (this.shouldQueueScan()) {
          const queued = await this.queueService?.enqueueUploadJob({ uploadId: asset.id, userId: asset.userId, type: UPLOAD_SCAN_JOB });
          if (queued?.queued) scansRequeued += 1;
        } else {
          await this.processUploadScan(asset.id);
          scansRequeued += 1;
        }
      } catch {}
    }
    let quarantineDeleted = 0;
    for (const asset of quarantined) {
      try {
        await this.prisma.uploadAsset.update({ where: { id: asset.id }, data: { status: "DELETION_PENDING" } });
        await this.processAssetDeletion(asset.id);
        quarantineDeleted += 1;
      } catch {}
    }
    let objectDeletionJobsProcessed = 0;
    for (const job of objectDeletionJobs) {
      try { await this.processObjectDeletionJob(job.id); objectDeletionJobsProcessed += 1; } catch {}
    }

    let orphanedCount = 0;
    if (this.storage.list) {
      const graceMs = Math.max(60_000, Number(process.env.UPLOAD_ORPHAN_GRACE_MS || 86_400_000));
      const prefix = input.userId ? `evidence/${input.userId}/` : "evidence/";
      const objects = (await this.storage.list(prefix)).filter((item) => item.lastModified && item.lastModified.getTime() < Date.now() - graceMs).slice(0, 500);
      if (objects.length) {
        const records = await this.prisma.uploadAsset.findMany({ where: { objectKey: { in: objects.map((item) => item.objectKey) } }, select: { objectKey: true } });
        const known = new Set(records.map((item) => item.objectKey));
        for (const object of objects) {
          if (!known.has(object.objectKey)) {
            await this.objectDeletions.schedule([{ objectKey: object.objectKey, storageProvider: this.storage.name }], "ORPHAN_OBJECT");
            const objectKeyHash = createHash("sha256").update(object.objectKey).digest("hex");
            const job = await this.prisma.objectDeletionJob.findUniqueOrThrow({ where: { storageProvider_objectKeyHash: { storageProvider: this.storage.name, objectKeyHash } } });
            await this.processObjectDeletionJob(job.id);
            orphanedCount += 1;
          }
        }
      }
    }
    return { expiredCount, deletedCount, scansRequeued, staleScans: staleScans.count, quarantineDeleted, objectDeletionJobsProcessed, orphanedCount, scannedAt: now.toISOString() };
  }

  private async buildUploadRequest(asset: { id: string; userId: string; objectKey: string; mimeType: string; sizeBytes: number; checksumSha256: string | null }) {
    const ttl = this.getUploadTtlSeconds();
    if (this.storage.supportsDirectUpload) {
      if (!this.storage.createUploadRequest || !asset.checksumSha256) throw new Error("Direct upload provider is incomplete");
      return this.storage.createUploadRequest({ objectKey: asset.objectKey, contentType: asset.mimeType, sizeBytes: asset.sizeBytes, checksumSha256: asset.checksumSha256, expiresInSeconds: ttl, metadata: { assetid: asset.id, userid: asset.userId } });
    }
    const expires = Math.floor(Date.now() / 1000) + ttl;
    return {
      method: "PUT" as const,
      url: `/uploads/evidence/${asset.id}/upload?expires=${expires}&signature=${this.sign(asset.userId, asset.id, "upload", expires)}`,
      headers: { "Content-Type": asset.mimeType },
      expiresAt: new Date(expires * 1000).toISOString()
    };
  }

  private async buildDownloadRequest(asset: { id: string; userId: string; objectKey: string; mimeType: string; fileName: string }) {
    const ttl = Math.max(60, Number(process.env.UPLOAD_URL_TTL_SECONDS ?? 900));
    if (this.storage.supportsDirectUpload) {
      if (!this.storage.createDownloadRequest) throw new Error("Direct download provider is incomplete");
      return this.storage.createDownloadRequest({ objectKey: asset.objectKey, contentType: asset.mimeType, fileName: asset.fileName, expiresInSeconds: ttl });
    }
    const expires = Math.floor(Date.now() / 1000) + ttl;
    return { method: "GET" as const, url: `/uploads/evidence/${asset.id}/download?expires=${expires}&signature=${this.sign(asset.userId, asset.id, "download", expires)}`, expiresAt: new Date(expires * 1000).toISOString() };
  }

  private getUploadTtlSeconds() {
    return Math.max(60, Number(process.env.UPLOAD_URL_TTL_SECONDS ?? 900));
  }

  private shouldQueueScan() {
    return process.env.UPLOAD_SCAN_ASYNC === "true";
  }

  private async verifyUploadedContent(
    asset: { mimeType: string; sizeBytes: number; checksumSha256: string | null },
    metadata: { sizeBytes: number; contentType?: string; checksumSha256?: string },
    content: Buffer
  ) {
    if (metadata.sizeBytes !== asset.sizeBytes || content.length !== asset.sizeBytes) {
      throw new BadRequestException("实际文件大小与声明不一致");
    }
    if (metadata.contentType && metadata.contentType.split(";")[0].toLowerCase() !== asset.mimeType) {
      throw new BadRequestException("对象存储 Content-Type 与声明不一致");
    }
    const detected = await fileTypeFromBuffer(content);
    if (!detected || detected.mime !== asset.mimeType) {
      throw new BadRequestException("文件魔数与声明类型不一致");
    }
    const checksumSha256 = createHash("sha256").update(content).digest("hex");
    if (asset.checksumSha256 && checksumSha256 !== asset.checksumSha256) {
      throw new BadRequestException("文件 SHA-256 校验失败");
    }
    if (metadata.checksumSha256 && checksumSha256 !== metadata.checksumSha256) {
      throw new BadRequestException("对象存储校验值不一致");
    }
    if (asset.mimeType.startsWith("image/")) {
      const dimensions = imageSize(content);
      const maxDimension = Math.max(256, Number(process.env.UPLOAD_MAX_IMAGE_DIMENSION || 12_000));
      const maxPixels = Math.max(1_000_000, Number(process.env.UPLOAD_MAX_IMAGE_PIXELS || 40_000_000));
      if (!dimensions.width || !dimensions.height || dimensions.width > maxDimension || dimensions.height > maxDimension || dimensions.width * dimensions.height > maxPixels) {
        throw new BadRequestException("图片尺寸超过安全限制");
      }
    }
    if (asset.mimeType === "application/pdf") {
      const pdf = await PDFDocument.load(content, { updateMetadata: false });
      const maxPages = Math.max(1, Number(process.env.UPLOAD_MAX_PDF_PAGES || 100));
      if (pdf.getPageCount() > maxPages) throw new BadRequestException("PDF 页数超过安全限制");
    }
    return { mimeType: detected.mime, sizeBytes: content.length, checksumSha256 };
  }

  private async rejectAsset(asset: { id: string; userId: string; objectKey: string }, reason: string) {
    try { await this.storage.delete(asset.objectKey); } catch {}
    await this.prisma.$transaction(async (tx) => {
      await tx.uploadAsset.update({ where: { id: asset.id }, data: { status: "REJECTED", scanStatus: "REJECTED", scanResult: reason.slice(0, 2000), deletedAt: new Date() } });
      await this.quotaService.releaseWithClient(tx, asset.userId, "UPLOAD_STORAGE_KIB", "UPLOAD_ASSET", asset.id);
    });
  }

  private assertSignature(
    asset: { id: string; userId: string },
    action: "upload" | "download",
    expiresValue: string,
    signature: string
  ) {
    const expires = Number(expiresValue);
    const expected = this.sign(asset.userId, asset.id, action, expires);
    const valid = Number.isInteger(expires) &&
      expires >= Math.floor(Date.now() / 1000) &&
      signature.length === expected.length &&
      timingSafeEqual(Buffer.from(signature), Buffer.from(expected));

    if (!valid) {
      throw new BadRequestException("上传签名无效或已过期");
    }
  }

  private sign(userId: string, assetId: string, action: string, expires: number) {
    const secret = process.env.UPLOAD_SIGNING_SECRET || process.env.SESSION_SECRET;

    if (!secret) {
      throw new Error("UPLOAD_SIGNING_SECRET or SESSION_SECRET is required");
    }

    return createHmac("sha256", secret)
      .update(`${userId}:${assetId}:${action}:${expires}`)
      .digest("hex");
  }

  private parseUploadPayload(input: unknown) {
    if (!input || typeof input !== "object") {
      throw new BadRequestException("上传参数不正确");
    }

    const body = input as Record<string, unknown>;
    const source = this.parseEnum(body.source, ALLOWED_SOURCES, "WEB");
    const purpose = this.parseEnum(
      body.purpose,
      ALLOWED_PURPOSES,
      "CHECKIN_EVIDENCE"
    );
    const fileName = this.cleanText(body.fileName, 180);
    const mimeType = this.cleanText(body.mimeType, 120).toLowerCase();
    const sizeBytes = Number(body.sizeBytes);
    const checksumSha256 = this.cleanText(body.checksumSha256, 64).toLowerCase();
    if (body.publicUrl != null) {
      throw new BadRequestException("不允许通过外部 URL 绕过上传扫描");
    }
    const metadata = this.parseMetadata(body.metadata);
    const goalId = metadata && typeof metadata === "object" && !Array.isArray(metadata) && typeof (metadata as Record<string, unknown>).goalId === "string"
      ? this.cleanText((metadata as Record<string, unknown>).goalId, 191)
      : null;

    if (!fileName) {
      throw new BadRequestException("文件名不能为空");
    }

    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new BadRequestException("暂不支持该文件类型");
    }

    if (
      !Number.isInteger(sizeBytes) ||
      sizeBytes <= 0 ||
      sizeBytes > MAX_UPLOAD_SIZE_BYTES
    ) {
      throw new BadRequestException("文件大小必须在 1B 到 10MB 之间");
    }

    if (checksumSha256 && !/^[a-f0-9]{64}$/.test(checksumSha256)) {
      throw new BadRequestException("文件校验值必须是 SHA-256 十六进制字符串");
    }

    return {
      source,
      purpose,
      fileName,
      mimeType,
      sizeBytes,
      checksumSha256: checksumSha256 || null,
      goalId,
      metadata
    };
  }

  private parseEnum(value: unknown, allowed: Set<string>, fallback: string) {
    const normalized =
      typeof value === "string" ? value.trim().toUpperCase() : fallback;

    return allowed.has(normalized) ? normalized : fallback;
  }

  private cleanText(value: unknown, maxLength: number) {
    return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
  }

  private parseMetadata(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }

    return value as Prisma.InputJsonValue;
  }

  private buildObjectKey(userId: string) {
    return `evidence/${userId}/${randomUUID()}`;
  }

  private serializeUploadAsset(asset: UploadAsset) {
    return {
      id: asset.id,
      userId: asset.userId,
      source: asset.source,
      purpose: asset.purpose,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      checksumSha256: asset.checksumSha256,
      storageProvider: asset.storageProvider,
      objectKey: asset.objectKey,
      publicUrl: asset.publicUrl,
      status: asset.status,
      scanStatus: asset.scanStatus,
      scanResult: asset.scanResult,
      verifiedMimeType: asset.verifiedMimeType,
      verifiedSizeBytes: asset.verifiedSizeBytes,
      uploadExpiresAt: asset.uploadExpiresAt?.toISOString() ?? null,
      scanAttempts: asset.scanAttempts,
      scanStartedAt: asset.scanStartedAt?.toISOString() ?? null,
      scanCompletedAt: asset.scanCompletedAt?.toISOString() ?? null,
      deleteAttempts: asset.deleteAttempts,
      deleteError: asset.deleteError,
      lastDeleteAttemptAt: asset.lastDeleteAttemptAt?.toISOString() ?? null,
      uploadedAt: asset.uploadedAt?.toISOString() ?? null,
      deletedAt: asset.deletedAt?.toISOString() ?? null,
      metadata: asset.metadata,
      createdAt: asset.createdAt.toISOString(),
      updatedAt: asset.updatedAt.toISOString()
    };
  }

  private toEvidenceFile(asset: Pick<UploadAsset, "id" | "fileName" | "mimeType" | "sizeBytes" | "checksumSha256" | "storageProvider" | "objectKey" | "publicUrl" | "status" | "scanStatus">) {
    return {
      uploadId: asset.id,
      name: asset.fileName,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      checksumSha256: asset.checksumSha256,
      storageProvider: asset.storageProvider,
      objectKey: asset.objectKey,
      url: asset.publicUrl ?? `/uploads/evidence/${asset.id}`,
      status: asset.status,
      scanStatus: asset.scanStatus
    };
  }
}
