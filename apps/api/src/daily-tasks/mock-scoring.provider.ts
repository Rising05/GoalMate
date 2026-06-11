import { Injectable } from "@nestjs/common";
import { ScoreInput, ScoringProvider } from "./scoring-provider";

const RESCUE_TASK_TYPE = "RESCUE";

@Injectable()
export class MockScoringProvider implements ScoringProvider {
  readonly name = "mock-scorer";

  score(input: ScoreInput) {
    const { content, investedMinutes, task } = input;
    const contentScore = Math.min(20, Math.floor(content.length / 6));
    const timeScore = Math.min(20, Math.floor(investedMinutes / 5));
    const plannedMinutes = task.plannedMinutes ?? investedMinutes;
    const timeMatch = plannedMinutes
      ? Math.max(60, 100 - Math.abs(plannedMinutes - investedMinutes))
      : 82;
    const totalScore = Math.max(60, Math.min(98, 62 + contentScore + timeScore));

    return {
      totalScore,
      dimensions: {
        completion: totalScore,
        timeMatch,
        evidence: Math.max(60, totalScore - 8),
        reflection: Math.max(60, totalScore - 4)
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
        contentLength: content.length
      },
      summary:
        task.taskType === RESCUE_TASK_TYPE
          ? `已完成救援任务「${task.title}」，补救动作和复盘已进入成长记录。`
          : `已完成「${task.title}」，本次复盘内容和投入时间已记录。`,
      suggestion:
        task.taskType === RESCUE_TASK_TYPE
          ? totalScore >= 88
            ? "补救效果较好，明天可以回到原计划节奏。"
            : "补救链路已经恢复，明天继续保留一个更小的起步动作。"
          : totalScore >= 88
            ? "今天执行质量较高，明天可以继续按原计划推进。"
            : "明天优先补充更具体的完成证据，并尽量贴近计划投入时间。"
    };
  }
}
