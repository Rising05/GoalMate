import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { loadEnv } from "../config/load-env";
import { PrismaService } from "../prisma/prisma.service";
import { UploadsService } from "./uploads.service";

loadEnv();

const TEST_EMAIL_PREFIX = "uploads-integration-";

const prisma = new PrismaService();
const uploadsService = new UploadsService(prisma);

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
    assert.equal(result.asset.storageProvider, "LOCAL_PLACEHOLDER");
    assert.match(result.asset.objectKey, new RegExp(`^evidence/${user.id}/`));
    assert.equal(result.evidenceFile.uploadId, result.asset.id);
    assert.equal(result.evidenceFile.url, "https://example.com/mock-review.png");
    assert.equal(stored.userId, user.id);
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
