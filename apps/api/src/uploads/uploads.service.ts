import {
  BadRequestException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";

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
  constructor(private readonly prisma: PrismaService) {}

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
        storageProvider: "LOCAL_PLACEHOLDER",
        objectKey: this.buildObjectKey(userId, payload.fileName),
        publicUrl: payload.publicUrl,
        metadata: payload.metadata
      }
    });

    return {
      asset: this.serializeUploadAsset(asset),
      evidenceFile: this.toEvidenceFile(asset)
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
      evidenceFile: this.toEvidenceFile(asset)
    };
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
