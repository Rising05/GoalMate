import "reflect-metadata";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { AddressInfo, createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { after, before, describe, it } from "node:test";
import { loadEnv } from "../config/load-env";
import { PrismaService } from "../prisma/prisma.service";
import { ClamAvFileScanner, MockFileScanner } from "./file-scanner";
import { S3StorageProvider } from "./s3-storage.provider";
import { SignedStorageRequest, StorageDownloadRequest, StorageObjectMetadata, StorageProvider, StorageUploadRequest } from "./storage-provider";
import { LocalStorageProvider } from "./storage-provider";
import { UploadsService } from "./uploads.service";
import { QueueService } from "../queue/queue.service";

loadEnv();
const prisma = new PrismaService();
const email = "uploads-provider-integration@example.com";

describe("Upload providers integration", () => {
  before(async () => prisma.user.deleteMany({ where: { email } }));
  after(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
  });

  it("completes a direct upload only after server verification and scanning", async () => {
    const user = await prisma.user.create({ data: { email, passwordHash: "test" } });
    const storage = new MemoryDirectStorage();
    const service = new UploadsService(prisma, storage, undefined, new MockFileScanner());
    const content = onePixelPng();
    const checksumSha256 = createHash("sha256").update(content).digest("hex");
    const registered = await service.createEvidenceUpload(user.id, { fileName: "proof.png", mimeType: "image/png", sizeBytes: content.length, checksumSha256 });
    assert.equal(registered.asset.status, "PENDING_UPLOAD");
    assert.equal(registered.upload.url, "https://storage.test/upload");
    await storage.put(registered.asset.objectKey, content);
    const completed = await service.completeEvidenceUpload(user.id, registered.asset.id);
    assert.equal(completed.asset.status, "READY");
    assert.equal(completed.asset.scanStatus, "CLEAN");
    assert.equal(completed.asset.verifiedMimeType, "image/png");
    assert.equal(completed.asset.verifiedSizeBytes, content.length);
    assert.equal(completed.download?.url, "https://storage.test/download");
  });

  it("creates an S3 checksum-bound presigned PUT without network access", async () => {
    const previous = snapshotEnv(["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]);
    Object.assign(process.env, { S3_BUCKET: "private-test-bucket", S3_REGION: "us-east-1", S3_ACCESS_KEY_ID: "test-access", S3_SECRET_ACCESS_KEY: "test-secret" });
    const provider = new S3StorageProvider();
    try {
      const request = await provider.createUploadRequest({ objectKey: "evidence/user/object", contentType: "image/png", sizeBytes: 68, checksumSha256: "a".repeat(64), expiresInSeconds: 60, metadata: { assetid: "asset" } });
      assert.match(request.url, /^https:\/\/private-test-bucket\.s3\.us-east-1\.amazonaws\.com\//);
      assert.equal(request.method, "PUT");
      assert.ok(request.headers?.["x-amz-checksum-sha256"]);
      assert.match(request.url, /X-Amz-Signature=/);
    } finally { provider.onModuleDestroy(); restoreEnv(previous); }
  });

  it("round-trips private objects through the real S3 SDK protocol", async () => {
    const objects = new Map<string, { content: Buffer; contentType: string; checksum: string }>();
    const server = createHttpServer(async (request, response) => {
      const url = new URL(request.url || "/", "http://localhost");
      const key = decodeURIComponent(url.pathname.replace(/^\/private-test-bucket\/?/, ""));
      if (request.method === "GET" && url.searchParams.get("list-type") === "2") {
        const contents = Array.from(objects.entries()).map(([objectKey, item]) => `<Contents><Key>${objectKey}</Key><LastModified>${new Date().toISOString()}</LastModified><Size>${item.content.length}</Size></Contents>`).join("");
        response.end(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>private-test-bucket</Name><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`);
        return;
      }
      if (request.method === "PUT") {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        objects.set(key, { content: Buffer.concat(chunks), contentType: String(request.headers["content-type"] || "application/octet-stream"), checksum: String(request.headers["x-amz-checksum-sha256"] || "") });
        response.setHeader("etag", '"test-etag"');
        response.statusCode = 200;
        response.end();
        return;
      }
      const object = objects.get(key);
      if (!object) { response.statusCode = 404; response.end("Not Found"); return; }
      if (request.method === "HEAD") {
        response.setHeader("content-length", String(object.content.length));
        response.setHeader("content-type", object.contentType);
        response.setHeader("x-amz-checksum-sha256", object.checksum);
        response.setHeader("last-modified", new Date().toUTCString());
        response.end();
        return;
      }
      if (request.method === "GET") { response.setHeader("content-type", object.contentType); response.end(object.content); return; }
      if (request.method === "DELETE") { objects.delete(key); response.statusCode = 204; response.end(); return; }
      response.statusCode = 405;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const previous = snapshotEnv(["S3_BUCKET", "S3_REGION", "S3_ENDPOINT", "S3_FORCE_PATH_STYLE", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]);
    Object.assign(process.env, { S3_BUCKET: "private-test-bucket", S3_REGION: "us-east-1", S3_ENDPOINT: `http://127.0.0.1:${address.port}`, S3_FORCE_PATH_STYLE: "true", S3_ACCESS_KEY_ID: "test-access", S3_SECRET_ACCESS_KEY: "test-secret" });
    const provider = new S3StorageProvider();
    try {
      const content = onePixelPng();
      const checksum = createHash("sha256").update(content).digest("hex");
      const upload = await provider.createUploadRequest({ objectKey: "evidence/user/roundtrip", contentType: "image/png", sizeBytes: content.length, checksumSha256: checksum, expiresInSeconds: 60, metadata: {} });
      const uploadResponse = await fetch(upload.url, { method: "PUT", headers: upload.headers, body: content });
      assert.equal(uploadResponse.status, 200);
      assert.equal((await provider.inspect("evidence/user/roundtrip"))?.checksumSha256, checksum);
      assert.deepEqual(await provider.get("evidence/user/roundtrip"), content);
      assert.equal((await provider.list("evidence/"))[0].objectKey, "evidence/user/roundtrip");
      const download = await provider.createDownloadRequest({ objectKey: "evidence/user/roundtrip", fileName: "proof.png", contentType: "image/png", expiresInSeconds: 60 });
      assert.deepEqual(Buffer.from(await (await fetch(download.url)).arrayBuffer()), content);
      await provider.delete("evidence/user/roundtrip");
      assert.equal(await provider.inspect("evidence/user/roundtrip"), null);
    } finally {
      provider.onModuleDestroy();
      restoreEnv(previous);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("keeps direct uploads unavailable until the scan worker succeeds", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const storage = new MemoryDirectStorage();
    const queue = { isEnabled: () => true, enqueueUploadJob: async () => ({ queued: true, queueName: "uploads", jobId: "scan-job" }) } as unknown as QueueService;
    const previous = snapshotEnv(["UPLOAD_SCAN_ASYNC"]);
    process.env.UPLOAD_SCAN_ASYNC = "true";
    try {
      const service = new UploadsService(prisma, storage, undefined, new MockFileScanner(), queue);
      const content = onePixelPng();
      const checksumSha256 = createHash("sha256").update(content).digest("hex");
      const registered = await service.createEvidenceUpload(user.id, { fileName: "async.png", mimeType: "image/png", sizeBytes: content.length, checksumSha256 });
      await storage.put(registered.asset.objectKey, content);
      const completed = await service.completeEvidenceUpload(user.id, registered.asset.id);
      assert.equal(completed.asset.status, "UPLOADED");
      assert.equal(completed.download, null);
      const scanned = await service.processUploadScan(registered.asset.id);
      assert.equal(scanned.asset.status, "READY");
      assert.ok(scanned.download);
    } finally { restoreEnv(previous); }
  });

  it("rejects local storage in production", () => {
    const previous = snapshotEnv(["NODE_ENV"]);
    process.env.NODE_ENV = "production";
    try {
      const service = new UploadsService(prisma, new LocalStorageProvider());
      assert.throws(() => service.onModuleInit(), /direct object storage/);
    } finally { restoreEnv(previous); }
  });

  it("implements the ClamAV INSTREAM protocol and parses malware signatures", async () => {
    const server = createServer((socket) => {
      const chunks: Buffer[] = [];
      socket.on("data", (chunk) => {
        chunks.push(Buffer.from(chunk));
        const payload = Buffer.concat(chunks);
        if (hasCompleteInstream(payload)) socket.end("stream: Eicar-Test-Signature FOUND\0");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const previous = snapshotEnv(["CLAMAV_HOST", "CLAMAV_PORT"]);
    process.env.CLAMAV_HOST = "127.0.0.1";
    process.env.CLAMAV_PORT = String(address.port);
    try {
      const result = await new ClamAvFileScanner().scan(Buffer.from("EICAR test"));
      assert.equal(result.clean, false);
      assert.equal(result.signature, "Eicar-Test-Signature");
    } finally {
      restoreEnv(previous);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

class MemoryDirectStorage implements StorageProvider {
  readonly name = "S3_TEST";
  readonly supportsDirectUpload = true;
  private readonly objects = new Map<string, Buffer>();
  private readonly types = new Map<string, string>();
  async put(objectKey: string, content: Buffer) { this.objects.set(objectKey, content); }
  async get(objectKey: string) { const value = this.objects.get(objectKey); if (!value) throw new Error("missing object"); return value; }
  async delete(objectKey: string) { this.objects.delete(objectKey); }
  async inspect(objectKey: string): Promise<StorageObjectMetadata | null> { const value = this.objects.get(objectKey); return value ? { objectKey, sizeBytes: value.length, contentType: this.types.get(objectKey) ?? "image/png", checksumSha256: createHash("sha256").update(value).digest("hex"), lastModified: new Date() } : null; }
  async createUploadRequest(input: StorageUploadRequest): Promise<SignedStorageRequest> { this.types.set(input.objectKey, input.contentType); return { method: "PUT", url: "https://storage.test/upload", expiresAt: new Date(Date.now() + 60_000).toISOString() }; }
  async createDownloadRequest(_input: StorageDownloadRequest): Promise<SignedStorageRequest> { return { method: "GET", url: "https://storage.test/download", expiresAt: new Date(Date.now() + 60_000).toISOString() }; }
}

function onePixelPng() { return Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"); }

function hasCompleteInstream(payload: Buffer) {
  const header = Buffer.from("zINSTREAM\0");
  if (payload.length < header.length || !payload.subarray(0, header.length).equals(header)) return false;
  let offset = header.length;
  while (offset + 4 <= payload.length) {
    const length = payload.readUInt32BE(offset);
    offset += 4;
    if (length === 0) return true;
    if (offset + length > payload.length) return false;
    offset += length;
  }
  return false;
}

function snapshotEnv(keys: string[]) { return Object.fromEntries(keys.map((key) => [key, process.env[key]])); }
function restoreEnv(values: Record<string, string | undefined>) { for (const [key, value] of Object.entries(values)) { if (value == null) delete process.env[key]; else process.env[key] = value; } }
