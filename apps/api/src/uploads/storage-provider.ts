import { Injectable } from "@nestjs/common";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const STORAGE_PROVIDER = Symbol("STORAGE_PROVIDER");

export interface StorageProvider {
  readonly name: string;
  readonly supportsDirectUpload: boolean;
  put(objectKey: string, content: Buffer): Promise<void>;
  get(objectKey: string): Promise<Buffer>;
  delete(objectKey: string): Promise<void>;
  inspect(objectKey: string): Promise<StorageObjectMetadata | null>;
  createUploadRequest?(input: StorageUploadRequest): Promise<SignedStorageRequest>;
  createDownloadRequest?(input: StorageDownloadRequest): Promise<SignedStorageRequest>;
  list?(prefix: string): Promise<StorageObjectMetadata[]>;
}

export interface StorageObjectMetadata {
  objectKey: string;
  sizeBytes: number;
  contentType?: string;
  checksumSha256?: string;
  lastModified?: Date;
}

export interface StorageUploadRequest {
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  checksumSha256: string;
  expiresInSeconds: number;
  metadata: Record<string, string>;
}

export interface StorageDownloadRequest {
  objectKey: string;
  fileName: string;
  contentType: string;
  expiresInSeconds: number;
}

export interface SignedStorageRequest {
  method: "PUT" | "GET";
  url: string;
  headers?: Record<string, string>;
  expiresAt: string;
}

@Injectable()
export class LocalStorageProvider implements StorageProvider {
  readonly name = "LOCAL";
  readonly supportsDirectUpload = false;
  private readonly root = resolve(
    process.env.UPLOAD_STORAGE_PATH?.trim() || ".data/uploads"
  );

  async put(objectKey: string, content: Buffer) {
    const filePath = this.resolveObjectKey(objectKey);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, { flag: "wx" });
  }

  get(objectKey: string) {
    return readFile(this.resolveObjectKey(objectKey));
  }

  async delete(objectKey: string) {
    await rm(this.resolveObjectKey(objectKey), { force: true });
  }

  async inspect(objectKey: string): Promise<StorageObjectMetadata | null> {
    try {
      const file = await stat(this.resolveObjectKey(objectKey));
      return { objectKey, sizeBytes: file.size, lastModified: file.mtime };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  }

  async list(prefix: string) {
    const base = this.resolveObjectKey(prefix);
    const objects: StorageObjectMetadata[] = [];
    const visit = async (directory: string) => {
      let entries;
      try { entries = await readdir(directory, { withFileTypes: true }); }
      catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
        throw error;
      }
      for (const entry of entries) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) await visit(path);
        else if (entry.isFile()) {
          const file = await stat(path);
          objects.push({ objectKey: path.slice(this.root.length + 1), sizeBytes: file.size, lastModified: file.mtime });
        }
      }
    };
    await visit(base);
    return objects;
  }

  private resolveObjectKey(objectKey: string) {
    const filePath = resolve(this.root, objectKey);

    if (!filePath.startsWith(`${this.root}/`)) {
      throw new Error("Invalid storage object key");
    }

    return filePath;
  }
}
