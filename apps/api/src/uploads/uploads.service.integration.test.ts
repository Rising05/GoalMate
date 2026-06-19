import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { BadRequestException, HttpException, NotFoundException } from "@nestjs/common";
import { loadEnv } from "../config/load-env";
import { PrismaService } from "../prisma/prisma.service";
import { UploadsService } from "./uploads.service";
import { LocalStorageProvider } from "./storage-provider";

loadEnv();

const TEST_EMAIL_PREFIX = "uploads-integration-";

const prisma = new PrismaService();
const uploadsService = new UploadsService(prisma, new LocalStorageProvider());

describe("UploadsService integration", () => {
  before(async () => {
    await cleanupTestUsers();
  });

  after(async () => {
    await cleanupTestUsers();
    await prisma.$disconnect();
  });

  it("creates a check-in evidence upload metadata record", async () => {
    const user = await createUser("create");
    const result = await uploadsService.createEvidenceUpload(user.id, {
      source: "WECHAT",
      purpose: "CHECKIN_EVIDENCE",
      fileName: "mock-review.png",
      mimeType: "image/png",
      sizeBytes: 512_000,
      checksumSha256:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      publicUrl: "https://example.com/mock-review.png",
      metadata: {
        taskId: "daily-task-demo",
        note: "模考截图"
      }
    });
    const stored = await prisma.uploadAsset.findUniqueOrThrow({
      where: { id: result.asset.id }
    });

    assert.equal(result.asset.userId, user.id);
    assert.equal(result.asset.source, "WECHAT");
    assert.equal(result.asset.purpose, "CHECKIN_EVIDENCE");
    assert.equal(result.asset.mimeType, "image/png");
    assert.equal(result.asset.sizeBytes, 512_000);
    assert.equal(result.asset.storageProvider, "EXTERNAL");
    assert.match(result.asset.objectKey, new RegExp(`^evidence/${user.id}/`));
    assert.equal(result.evidenceFile.uploadId, result.asset.id);
    assert.equal(result.evidenceFile.url, "https://example.com/mock-review.png");
    assert.equal(stored.userId, user.id);
  });

  it("uploads and downloads signed local evidence with content validation", async () => {
    const owner = await createUser("signed-owner");
    const other = await createUser("signed-other");
    const content = Buffer.concat([
      Buffer.from("89504e470d0a1a0a", "hex"),
      Buffer.from("goalmate-test-image")
    ]);
    const registered = await uploadsService.createEvidenceUpload(owner.id, {
      fileName: "proof.png",
      mimeType: "image/png",
      sizeBytes: content.length
    });
    const uploadUrl = new URL(registered.upload!.url, "http://localhost");
    const expires = uploadUrl.searchParams.get("expires")!;
    const signature = uploadUrl.searchParams.get("signature")!;

    await assert.rejects(
      () => uploadsService.storeEvidenceContent(
        other.id,
        registered.asset.id,
        expires,
        signature,
        "image/png",
        content
      ),
      NotFoundException
    );
    await assert.rejects(
      () => uploadsService.storeEvidenceContent(
        owner.id,
        registered.asset.id,
        expires,
        `${signature.slice(0, -1)}${signature.endsWith("0") ? "1" : "0"}`,
        "image/png",
        content
      ),
      BadRequestException
    );

    const uploaded = await uploadsService.storeEvidenceContent(
      owner.id,
      registered.asset.id,
      expires,
      signature,
      "image/png",
      content
    );
    const downloadUrl = new URL(uploaded.download.url, "http://localhost");
    const downloaded = await uploadsService.readEvidenceContent(
      owner.id,
      registered.asset.id,
      downloadUrl.searchParams.get("expires")!,
      downloadUrl.searchParams.get("signature")!
    );

    assert.equal(uploaded.asset.status, "READY");
    assert.equal(uploaded.asset.scanStatus, "CLEAN");
    assert.deepEqual(downloaded.content, content);

    await uploadsService.deleteEvidenceUpload(owner.id, registered.asset.id);
    await assert.rejects(
      () => uploadsService.readEvidenceContent(
        owner.id,
        registered.asset.id,
        downloadUrl.searchParams.get("expires")!,
        downloadUrl.searchParams.get("signature")!
      ),
      NotFoundException
    );
  });

  it("rejects uploaded bytes that do not match the declared MIME type", async () => {
    const user = await createUser("magic-mismatch");
    const content = Buffer.from("this is not a png");
    const registered = await uploadsService.createEvidenceUpload(user.id, {
      fileName: "fake.png",
      mimeType: "image/png",
      sizeBytes: content.length
    });
    const uploadUrl = new URL(registered.upload!.url, "http://localhost");

    await assert.rejects(
      () => uploadsService.storeEvidenceContent(
        user.id,
        registered.asset.id,
        uploadUrl.searchParams.get("expires")!,
        uploadUrl.searchParams.get("signature")!,
        "image/png",
        content
      ),
      BadRequestException
    );
    const rejected = await prisma.uploadAsset.findUniqueOrThrow({
      where: { id: registered.asset.id }
    });

    assert.equal(rejected.status, "REJECTED");
    assert.equal(rejected.scanStatus, "REJECTED");
  });

  it("returns upload metadata only to the owning user", async () => {
    const owner = await createUser("owner");
    const other = await createUser("other");
    const result = await uploadsService.createEvidenceUpload(owner.id, {
      fileName: "proof.pdf",
      mimeType: "application/pdf",
      sizeBytes: 128_000
    });

    const ownRead = await uploadsService.getEvidenceUpload(owner.id, result.asset.id);

    assert.equal(ownRead.asset.id, result.asset.id);
    assert.equal(ownRead.evidenceFile.url, `/uploads/evidence/${result.asset.id}`);
    await assert.rejects(
      () => uploadsService.getEvidenceUpload(other.id, result.asset.id),
      NotFoundException
    );
  });

  it("validates evidence upload metadata before persisting", async () => {
    const user = await createUser("invalid");

    await assert.rejects(
      () =>
        uploadsService.createEvidenceUpload(user.id, {
          fileName: "script.js",
          mimeType: "application/javascript",
          sizeBytes: 100
        }),
      BadRequestException
    );
    await assert.rejects(
      () =>
        uploadsService.createEvidenceUpload(user.id, {
          fileName: "large.png",
          mimeType: "image/png",
          sizeBytes: 20 * 1024 * 1024
        }),
      BadRequestException
    );
    await assert.rejects(
      () =>
        uploadsService.createEvidenceUpload(user.id, {
          fileName: "proof.png",
          mimeType: "image/png",
          sizeBytes: 100,
          publicUrl: "file:///tmp/proof.png"
        }),
      BadRequestException
    );
  });

  it("enforces storage capacity and releases reserved space after deletion", async () => {
    const user = await createUser("quota");
    const assets = [];

    for (let index = 0; index < 5; index += 1) {
      assets.push(
        (await uploadsService.createEvidenceUpload(user.id, {
          source: "WEB",
          purpose: "CHECKIN_EVIDENCE",
          fileName: `quota-${index}.pdf`,
          mimeType: "application/pdf",
          sizeBytes: 10 * 1024 * 1024
        })).asset
      );
    }

    await assert.rejects(
      () => uploadsService.createEvidenceUpload(user.id, {
        source: "WEB",
        purpose: "CHECKIN_EVIDENCE",
        fileName: "quota-overflow.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024
      }),
      (error: unknown) => error instanceof HttpException && error.getStatus() === 429
    );
    await uploadsService.deleteEvidenceUpload(user.id, assets[0].id);
    const replacement = await uploadsService.createEvidenceUpload(user.id, {
      source: "WEB",
      purpose: "CHECKIN_EVIDENCE",
      fileName: "quota-replacement.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024
    });
    assert.equal(replacement.asset.status, "PENDING_UPLOAD");
  });
});

async function cleanupTestUsers() {
  await prisma.user.deleteMany({
    where: {
      email: {
        startsWith: TEST_EMAIL_PREFIX
      }
    }
  });
}

async function createUser(scenario: string) {
  const suffix = `${scenario}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;

  return prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}${suffix}@example.com`,
      passwordHash: "test-password-hash",
      displayName: `Uploads ${scenario}`
    }
  });
}
