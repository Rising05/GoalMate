import { Injectable } from "@nestjs/common";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const STORAGE_PROVIDER = Symbol("STORAGE_PROVIDER");

export interface StorageProvider {
  readonly name: string;
  put(objectKey: string, content: Buffer): Promise<void>;
  get(objectKey: string): Promise<Buffer>;
  delete(objectKey: string): Promise<void>;
}

@Injectable()
export class LocalStorageProvider implements StorageProvider {
  readonly name = "LOCAL";
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

  private resolveObjectKey(objectKey: string) {
    const filePath = resolve(this.root, objectKey);

    if (!filePath.startsWith(`${this.root}/`)) {
      throw new Error("Invalid storage object key");
    }

    return filePath;
  }
}
