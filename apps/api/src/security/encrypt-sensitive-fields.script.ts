import { loadEnv } from "../config/load-env";
import { PrismaService } from "../prisma/prisma.service";
import { FieldEncryptionService } from "./field-encryption.service";

loadEnv();

const prisma = new PrismaService();
const fields = new FieldEncryptionService();

interface MigrationStats {
  scanned: number;
  updated: number;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const stats = {
    goals: await migrateGoals(dryRun),
    checkins: await migrateCheckins(dryRun),
    scoreAppeals: await migrateScoreAppeals(dryRun),
    rewardCards: await migrateRewardCards(dryRun),
    failureReports: await migrateFailureReports(dryRun),
    wechatBindings: await migrateWechatBindings(dryRun)
  };

  console.log(JSON.stringify({ dryRun, activeKeyVersion: fields.activeKeyVersion, stats }, null, 2));
}

async function migrateGoals(dryRun: boolean): Promise<MigrationStats> {
  const rows = await prisma.goal.findMany({ take: 10_000 });
  let updated = 0;

  for (const goal of rows) {
    const description = fields.encrypt(goal.description);
    const currentBaseline = fields.encryptNullable(goal.currentBaseline);
    const constraints = fields.encryptNullable(goal.constraints);
    const finalReward = fields.encryptNullable(goal.finalReward);
    const changed = [
      description.ciphertext !== goal.description,
      currentBaseline.ciphertext !== goal.currentBaseline,
      constraints.ciphertext !== goal.constraints,
      finalReward.ciphertext !== goal.finalReward
    ].some(Boolean);

    if (!changed) continue;
    updated += 1;
    if (dryRun) continue;
    await prisma.goal.update({
      where: { id: goal.id },
      data: {
        description: description.ciphertext,
        descriptionKeyVersion: description.keyVersion,
        currentBaseline: currentBaseline.ciphertext,
        currentBaselineKeyVersion: currentBaseline.ciphertext ? currentBaseline.keyVersion : null,
        constraints: constraints.ciphertext,
        constraintsKeyVersion: constraints.ciphertext ? constraints.keyVersion : null,
        finalReward: finalReward.ciphertext,
        finalRewardKeyVersion: finalReward.ciphertext ? finalReward.keyVersion : null
      }
    });
  }

  return { scanned: rows.length, updated };
}

async function migrateCheckins(dryRun: boolean): Promise<MigrationStats> {
  const rows = await prisma.checkin.findMany({ take: 10_000 });
  let updated = 0;

  for (const checkin of rows) {
    const content = fields.encrypt(checkin.content);
    const studyMood = fields.encryptNullable(checkin.studyMood);
    const difficultyLevel = fields.encryptNullable(checkin.difficultyLevel);
    const changed = [
      content.ciphertext !== checkin.content,
      studyMood.ciphertext !== checkin.studyMood,
      difficultyLevel.ciphertext !== checkin.difficultyLevel
    ].some(Boolean);

    if (!changed) continue;
    updated += 1;
    if (dryRun) continue;
    await prisma.checkin.update({
      where: { id: checkin.id },
      data: {
        content: content.ciphertext,
        contentKeyVersion: content.keyVersion,
        studyMood: studyMood.ciphertext,
        studyMoodKeyVersion: studyMood.ciphertext ? studyMood.keyVersion : null,
        difficultyLevel: difficultyLevel.ciphertext,
        difficultyLevelKeyVersion: difficultyLevel.ciphertext ? difficultyLevel.keyVersion : null
      }
    });
  }

  return { scanned: rows.length, updated };
}

async function migrateScoreAppeals(dryRun: boolean): Promise<MigrationStats> {
  const rows = await prisma.scoreAppeal.findMany({ take: 10_000 });
  let updated = 0;

  for (const appeal of rows) {
    const reason = fields.encrypt(appeal.reason);
    const addedFacts = fields.encrypt(appeal.addedFacts);
    const changed = reason.ciphertext !== appeal.reason || addedFacts.ciphertext !== appeal.addedFacts;

    if (!changed) continue;
    updated += 1;
    if (dryRun) continue;
    await prisma.scoreAppeal.update({
      where: { id: appeal.id },
      data: {
        reason: reason.ciphertext,
        reasonKeyVersion: reason.keyVersion,
        addedFacts: addedFacts.ciphertext,
        addedFactsKeyVersion: addedFacts.keyVersion
      }
    });
  }

  return { scanned: rows.length, updated };
}

async function migrateRewardCards(dryRun: boolean): Promise<MigrationStats> {
  const rows = await prisma.rewardCard.findMany({ take: 10_000 });
  let updated = 0;

  for (const card of rows) {
    const description = fields.encryptNullable(card.description);
    if (description.ciphertext === card.description) continue;
    updated += 1;
    if (dryRun) continue;
    await prisma.rewardCard.update({
      where: { id: card.id },
      data: {
        description: description.ciphertext,
        descriptionKeyVersion: description.ciphertext ? description.keyVersion : null
      }
    });
  }

  return { scanned: rows.length, updated };
}

async function migrateFailureReports(dryRun: boolean): Promise<MigrationStats> {
  const rows = await prisma.failureReport.findMany({ take: 10_000 });
  let updated = 0;

  for (const report of rows) {
    const reasonAnalysis = fields.encrypt(report.reasonAnalysis);
    const suggestion = fields.encrypt(report.suggestion);
    const changed = reasonAnalysis.ciphertext !== report.reasonAnalysis || suggestion.ciphertext !== report.suggestion;

    if (!changed) continue;
    updated += 1;
    if (dryRun) continue;
    await prisma.failureReport.update({
      where: { id: report.id },
      data: {
        reasonAnalysis: reasonAnalysis.ciphertext,
        reasonAnalysisKeyVersion: reasonAnalysis.keyVersion,
        suggestion: suggestion.ciphertext,
        suggestionKeyVersion: suggestion.keyVersion
      }
    });
  }

  return { scanned: rows.length, updated };
}

async function migrateWechatBindings(dryRun: boolean): Promise<MigrationStats> {
  const rows = await prisma.wechatBinding.findMany({ take: 10_000 });
  let updated = 0;

  for (const binding of rows) {
    const plainOpenId = fields.decrypt(binding.openId);
    const plainUnionId = fields.decryptNullable(binding.unionId);
    const openId = fields.encrypt(plainOpenId);
    const unionId = fields.encryptNullable(plainUnionId);
    const openIdHash = fields.blindIndex(plainOpenId);
    const unionIdHash = fields.blindIndex(plainUnionId);
    const changed = [
      openId.ciphertext !== binding.openId,
      unionId.ciphertext !== binding.unionId,
      openIdHash !== binding.openIdHash,
      unionIdHash !== binding.unionIdHash
    ].some(Boolean);

    if (!changed) continue;
    updated += 1;
    if (dryRun) continue;
    await prisma.wechatBinding.update({
      where: { id: binding.id },
      data: {
        openId: openId.ciphertext,
        openIdHash,
        openIdKeyVersion: openId.keyVersion,
        unionId: unionId.ciphertext,
        unionIdHash,
        unionIdKeyVersion: unionId.ciphertext ? unionId.keyVersion : null
      }
    });
  }

  return { scanned: rows.length, updated };
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
