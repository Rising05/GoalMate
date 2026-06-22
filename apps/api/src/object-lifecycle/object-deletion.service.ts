import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { Prisma, UploadAsset } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

type DeletionAsset = Pick<UploadAsset, "objectKey" | "storageProvider">;

@Injectable()
export class ObjectDeletionService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  schedule(assets: DeletionAsset[], sourceType: string, sourceId?: string | null) {
    return this.scheduleWithClient(this.prisma, assets, sourceType, sourceId);
  }

  async scheduleWithClient(
    client: PrismaService | Prisma.TransactionClient,
    assets: DeletionAsset[],
    sourceType: string,
    sourceId?: string | null
  ) {
    if (!assets.length) return { scheduled: 0 };
    const result = await client.objectDeletionJob.createMany({
      data: assets.map((asset) => ({
        storageProvider: asset.storageProvider,
        objectKey: asset.objectKey,
        objectKeyHash: createHash("sha256").update(asset.objectKey).digest("hex"),
        sourceType,
        sourceId: sourceId ?? null,
        status: "QUEUED"
      })),
      skipDuplicates: true
    });
    return { scheduled: result.count };
  }
}
