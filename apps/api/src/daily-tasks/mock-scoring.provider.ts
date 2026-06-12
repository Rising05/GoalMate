import { Injectable } from "@nestjs/common";
import { ScoreInput, ScoringProvider } from "./scoring-provider";

const RESCUE_TASK_TYPE = "RESCUE";

@Injectable()
export class MockScoringProvider implements ScoringProvider {
  readonly name = "mock-scorer";

  score(input: ScoreInput) {
    const { content, investedMinutes, task, evidence } = input;
    const contentScore = Math.min(20, Math.floor(content.length / 6));
    const timeScore = Math.min(20, Math.floor(investedMinutes / 5));
    const plannedMinutes = task.plannedMinutes ?? investedMinutes;
    const timeMatch = plannedMinutes
      ? Math.max(60, 100 - Math.abs(plannedMinutes - investedMinutes))
      : 82;
    const accuracyScore =
      typeof evidence.accuracy === "number"
        ? Math.max(50, Math.min(100, evidence.accuracy))
        : task.targetAccuracy ?? 78;
    const evidenceCount =
      evidence.completedSubtasks.length +
      evidence.evidenceFiles.length +
      evidence.evidenceLinks.length +
      (typeof evidence.actualQuestionCount === "number" ? 1 : 0) +
      (evidence.studyMood ? 1 : 0) +
      (evidence.difficultyLevel ? 1 : 0);
    const evidenceScore = Math.min(98, 62 + evidenceCount * 6);
    const questionScore =
      typeof evidence.actualQuestionCount === "number" && task.questionCount
        ? Math.round(
            Math.min(1.2, evidence.actualQuestionCount / task.questionCount) * 80
          )
        : 76;
    const totalScore = Math.max(
      60,
      Math.min(
        98,
        Math.round(
          (62 + contentScore + timeScore) * 0.35 +
            timeMatch * 0.2 +
            evidenceScore * 0.2 +
            accuracyScore * 0.15 +
            questionScore * 0.1
        )
      )
    );

    return {
      totalScore,
      dimensions: {
        completion: Math.max(totalScore, questionScore),
        timeMatch,
        evidence: evidenceScore,
        questionAccuracy: accuracyScore,
        reflection: Math.max(60, totalScore - 4),
        studyQuality: Math.round((accuracyScore + evidenceScore + totalScore) / 3)
      },
      evidence: {
        source: this.name,
        dailyTaskId: task.id,
        taskType: task.taskType,
        deviationEventId: task.deviationEventId,
        rescueTriggerCode: task.rescueTriggerCode,
        rescueRiskLevel: task.rescueRiskLevel,
        plannedMinutes,
        investedMinutes,
        contentLength: content.length,
        completedSubtaskCount: evidence.completedSubtasks.length,
        plannedQuestionCount: task.questionCount,
        actualQuestionCount: evidence.actualQuestionCount,
        correctQuestionCount: evidence.correctQuestionCount,
        accuracy: evidence.accuracy,
        evidenceFileCount: evidence.evidenceFiles.length,
        evidenceLinkCount: evidence.evidenceLinks.length,
        studyMood: evidence.studyMood,
        difficultyLevel: evidence.difficultyLevel
      },
      summary:
        task.taskType === RESCUE_TASK_TYPE
          ? `已完成救援任务「${task.title}」，补救动作和复盘已进入成长记录。`
          : typeof evidence.accuracy === "number"
            ? `已完成「${task.title}」，本次题量、正确率、证据和复盘已记录。`
            : `已完成「${task.title}」，本次复盘内容和投入时间已记录。`,
      suggestion:
        task.taskType === RESCUE_TASK_TYPE
          ? totalScore >= 88
            ? "补救效果较好，明天可以回到原计划节奏。"
            : "补救链路已经恢复，明天继续保留一个更小的起步动作。"
          : evidence.evidenceLinks.length || evidence.evidenceFiles.length
            ? "明天继续保留错题、笔记或截图证据，便于识别薄弱点。"
          : totalScore >= 88
            ? "今天执行质量较高，明天可以继续按原计划推进。"
            : "明天优先补充更具体的完成证据，并尽量贴近计划投入时间。"
    };
  }
}
