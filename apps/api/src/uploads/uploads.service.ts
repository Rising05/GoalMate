import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
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

@Injectable()
export class UploadsService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(STORAGE_PROVIDER)
    private readonly storage: StorageProvider = new LocalStorageProvider()
  ) {}

  async createEvidenceUpload(userId: string, input: unknown) {
    const payload = this.parseUploadPayload(input);
    const asset = await this.prisma.uploadAsset.create({
      data: {
        userId,
        source: payload.source,
        purpose: payload.purpose,
        fileName: payload.fileName,
        mimeType: payload.mimeType,
        sizeBytes: payload.sizeBytes,
        checksumSha256: payload.checksumSha256,
        storageProvider: payload.publicUrl ? "EXTERNAL" : this.storage.name,
        objectKey: this.buildObjectKey(userId, payload.fileName),
        publicUrl: payload.publicUrl,
        status: payload.publicUrl ? "READY" : "PENDING_UPLOAD",
        scanStatus: payload.publicUrl ? "NOT_REQUIRED" : "PENDING",
        metadata: payload.metadata
      }
    });

    return {
      asset: this.serializeUploadAsset(asset),
      evidenceFile: this.toEvidenceFile(asset),
      upload: payload.publicUrl ? null : this.buildSignedRequest(asset, "upload")
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
      download: asset.status === "READY" && !asset.publicUrl
        ? this.buildSignedRequest(asset, "download")
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

    if (asset.status !== "PENDING_UPLOAD") {
      throw new BadRequestException("上传资产当前不可写入");
    }

    if (content.length !== asset.sizeBytes) {
      throw new BadRequestException("实际文件大小与声明不一致");
    }

    if ((contentType ?? "").split(";")[0].trim().toLowerCase() !== asset.mimeType) {
      throw new BadRequestException("实际文件类型与声明不一致");
    }

    if (!this.matchesMagicBytes(asset.mimeType, content)) {
      await this.prisma.uploadAsset.update({
        where: { id: asset.id },
        data: {
          status: "REJECTED",
          scanStatus: "REJECTED",
          scanResult: "File signature does not match declared MIME type"
        }
      });
      throw new BadRequestException("文件内容与声明类型不匹配");
    }

    const checksum = createHash("sha256").update(content).digest("hex");

    if (asset.checksumSha256 && checksum !== asset.checksumSha256) {
      throw new BadRequestException("文件 SHA-256 校验失败");
    }

    await this.storage.put(asset.objectKey, content);
    const ready = await this.prisma.uploadAsset.update({
      where: { id: asset.id },
      data: {
        checksumSha256: checksum,
        status: "READY",
        scanStatus: "CLEAN",
        scanResult: "Built-in file signature validation passed",
        uploadedAt: new Date()
      }
    });

    return {
      asset: this.serializeUploadAsset(ready),
      evidenceFile: this.toEvidenceFile(ready),
      download: this.buildSignedRequest(ready, "download")
    };
  }

  async readEvidenceContent(
    userId: string,
    uploadId: string,
    expires: string,
    signature: string
  ) {
    const asset = await this.getOwnedAsset(userId, uploadId);
    this.assertSignature(asset, "download", expires, signature);

    if (asset.status !== "READY" || asset.publicUrl) {
      throw new NotFoundException("上传证据内容不存在");
    }

    return {
      asset,
      content: await this.storage.get(asset.objectKey)
    };
  }

  async deleteEvidenceUpload(userId: string, uploadId: string) {
    const asset = await this.getOwnedAsset(userId, uploadId);

    if (asset.storageProvider === this.storage.name) {
      await this.storage.delete(asset.objectKey);
    }

    const deleted = await this.prisma.uploadAsset.update({
      where: { id: asset.id },
      data: { status: "DELETED", deletedAt: new Date() }
    });

    return { asset: this.serializeUploadAsset(deleted) };
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

  private buildSignedRequest(
    asset: { id: string; userId: string },
    action: "upload" | "download"
  ) {
    const ttl = Math.max(60, Number(process.env.UPLOAD_URL_TTL_SECONDS ?? 900));
    const expires = Math.floor(Date.now() / 1000) + ttl;
    const signature = this.sign(asset.userId, asset.id, action, expires);

    return {
      method: action === "upload" ? "PUT" : "GET",
      url: `/uploads/evidence/${asset.id}/${action}?expires=${expires}&signature=${signature}`,
      expiresAt: new Date(expires * 1000).toISOString()
    };
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

  private matchesMagicBytes(mimeType: string, content: Buffer) {
    const hex = content.subarray(0, 12).toString("hex");
    const ascii = content.subarray(0, 6).toString("ascii");

    if (mimeType === "image/png") return hex.startsWith("89504e470d0a1a0a");
    if (mimeType === "image/jpeg") return hex.startsWith("ffd8ff");
    if (mimeType === "image/gif") return ascii === "GIF87a" || ascii === "GIF89a";
    if (mimeType === "application/pdf") return content.subarray(0, 5).toString() === "%PDF-";
    if (mimeType === "image/webp") {
      return content.subarray(0, 4).toString() === "RIFF" &&
        content.subarray(8, 12).toString() === "WEBP";
    }

    return false;
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
    const publicUrl = this.cleanOptionalUrl(body.publicUrl);
    const metadata = this.parseMetadata(body.metadata);

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
      publicUrl,
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

  private cleanOptionalUrl(value: unknown) {
    if (typeof value !== "string" || !value.trim()) {
      return null;
    }

    const url = value.trim().slice(0, 1000);

    try {
      const parsed = new URL(url);

      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("unsupported protocol");
      }
    } catch {
      throw new BadRequestException("文件访问地址必须是 http(s) URL");
    }

    return url;
  }

  private parseMetadata(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }

    return value as Prisma.InputJsonValue;
  }

  private buildObjectKey(userId: string, fileName: string) {
    const safeName = fileName
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "evidence";

    return `evidence/${userId}/${Date.now()}-${randomUUID()}-${safeName}`;
  }

  private serializeUploadAsset(asset: {
    id: string;
    userId: string;
    source: string;
    purpose: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    checksumSha256: string | null;
    storageProvider: string;
    objectKey: string;
    publicUrl: string | null;
    status: string;
    scanStatus: string;
    scanResult: string | null;
    uploadedAt: Date | null;
    deletedAt: Date | null;
    metadata: Prisma.JsonValue | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
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
      uploadedAt: asset.uploadedAt?.toISOString() ?? null,
      deletedAt: asset.deletedAt?.toISOString() ?? null,
      metadata: asset.metadata,
      createdAt: asset.createdAt.toISOString(),
      updatedAt: asset.updatedAt.toISOString()
    };
  }

  private toEvidenceFile(asset: {
    id: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    checksumSha256: string | null;
    storageProvider: string;
    objectKey: string;
    publicUrl: string | null;
  }) {
    return {
      uploadId: asset.id,
      name: asset.fileName,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      checksumSha256: asset.checksumSha256,
      storageProvider: asset.storageProvider,
      objectKey: asset.objectKey,
      url: asset.publicUrl ?? `/uploads/evidence/${asset.id}`
    };
  }
}
