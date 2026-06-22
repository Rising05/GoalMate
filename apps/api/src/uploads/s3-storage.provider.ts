import { Buffer } from "node:buffer";
import { Injectable, OnModuleDestroy } from "@nestjs/common";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  SignedStorageRequest,
  StorageDownloadRequest,
  StorageObjectMetadata,
  StorageProvider,
  StorageUploadRequest
} from "./storage-provider";

@Injectable()
export class S3StorageProvider implements StorageProvider, OnModuleDestroy {
  readonly name = "S3";
  readonly supportsDirectUpload = true;
  private readonly bucket = process.env.S3_BUCKET?.trim() ?? "";
  private readonly client: S3Client;

  constructor() {
    this.client = new S3Client({
      region: process.env.S3_REGION?.trim() || "us-east-1",
      endpoint: process.env.S3_ENDPOINT?.trim() || undefined,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      credentials: process.env.S3_ACCESS_KEY_ID?.trim() && process.env.S3_SECRET_ACCESS_KEY?.trim()
        ? { accessKeyId: process.env.S3_ACCESS_KEY_ID.trim(), secretAccessKey: process.env.S3_SECRET_ACCESS_KEY.trim() }
        : undefined
    });
  }

  assertConfigured() {
    if (!this.bucket) throw new Error("S3_BUCKET is required for S3 upload storage");
  }

  onModuleDestroy() {
    this.client.destroy();
  }

  async put(objectKey: string, content: Buffer) {
    this.assertConfigured();
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: objectKey, Body: content }));
  }

  async get(objectKey: string) {
    this.assertConfigured();
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }));
    if (!response.Body) throw new Error("S3 object body is empty");
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async delete(objectKey: string) {
    this.assertConfigured();
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
  }

  async inspect(objectKey: string): Promise<StorageObjectMetadata | null> {
    this.assertConfigured();
    try {
      const response = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey, ChecksumMode: "ENABLED" }));
      return {
        objectKey,
        sizeBytes: response.ContentLength ?? 0,
        contentType: response.ContentType,
        checksumSha256: response.ChecksumSHA256 ? Buffer.from(response.ChecksumSHA256, "base64").toString("hex") : response.Metadata?.sha256,
        lastModified: response.LastModified
      };
    } catch (error) {
      const status = error && typeof error === "object" && "$metadata" in error ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode : undefined;
      if (status === 404) return null;
      throw error;
    }
  }

  async createUploadRequest(input: StorageUploadRequest): Promise<SignedStorageRequest> {
    this.assertConfigured();
    const checksumBase64 = Buffer.from(input.checksumSha256, "hex").toString("base64");
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.objectKey,
      ContentType: input.contentType,
      ContentLength: input.sizeBytes,
      ChecksumSHA256: checksumBase64,
      Metadata: { ...input.metadata, sha256: input.checksumSha256 }
    });
    const url = await getSignedUrl(this.client, command, { expiresIn: input.expiresInSeconds });
    return {
      method: "PUT",
      url,
      headers: { "Content-Type": input.contentType, "x-amz-checksum-sha256": checksumBase64 },
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000).toISOString()
    };
  }

  async createDownloadRequest(input: StorageDownloadRequest): Promise<SignedStorageRequest> {
    this.assertConfigured();
    const encodedName = encodeURIComponent(input.fileName.replace(/[\r\n"]/g, "_"));
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: input.objectKey,
      ResponseContentType: input.contentType,
      ResponseContentDisposition: `attachment; filename="download"; filename*=UTF-8''${encodedName}`
    });
    return {
      method: "GET",
      url: await getSignedUrl(this.client, command, { expiresIn: input.expiresInSeconds }),
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000).toISOString()
    };
  }

  async list(prefix: string) {
    this.assertConfigured();
    const objects: StorageObjectMetadata[] = [];
    let continuationToken: string | undefined;
    do {
      const response = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: continuationToken }));
      for (const item of response.Contents ?? []) {
        if (item.Key) objects.push({ objectKey: item.Key, sizeBytes: item.Size ?? 0, lastModified: item.LastModified });
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
    return objects;
  }
}
