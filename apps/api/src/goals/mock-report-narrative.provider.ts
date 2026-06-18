import { Injectable } from "@nestjs/common";
import {
  GeneratedReportNarrative,
  ReportNarrativeInput,
  ReportNarrativeProvider
} from "./report-narrative.provider";

@Injectable()
export class MockReportNarrativeProvider implements ReportNarrativeProvider {
  readonly name = "mock-report";
  readonly model = "rule-v1";

  generate(input: ReportNarrativeInput): GeneratedReportNarrative {
    const periodLabel = input.type === "WEEKLY_TREND" ? "周报" : "月报";
    const scoreText =
      input.averageHealthScore === null
        ? "本周期暂无足够健康快照形成平均分。"
        : `本周期平均健康分为 ${input.averageHealthScore} 分，范围 ${input.minHealthScore}-${input.maxHealthScore} 分。`;
    const trendText = buildTrendText(input);
    const recommendations = buildRecommendations(input);
    const body = [
      `# ${input.goalTitle} ${periodLabel}`,
      "",
      `周期：${input.startsOn} 至 ${input.endsOn}`,
      "",
      "## 执行摘要",
      "",
      scoreText,
      trendText,
      `本周期记录 ${input.snapshotCount} 天健康快照，主要风险状态为 ${riskLabel(input.dominantRiskLevel)}。`,
      "",
      "## 关键观察",
      "",
      ...input.insights.map((insight) => `- ${insight}`),
      "",
      "## 下一步建议",
      "",
      ...recommendations.map((recommendation) => `- ${recommendation}`)
    ].join("\n");

    return {
      title: `${input.goalTitle} ${periodLabel}（${input.endsOn}）`,
      summary: `${scoreText}${trendText}`,
      body,
      recommendations
    };
  }
}

function buildTrendText(input: ReportNarrativeInput) {
  if (input.scoreDelta === null || input.trendDirection === "no_data") {
    return "上一周期数据不足，暂不判断升降趋势。";
  }

  if (input.trendDirection === "up") {
    return `较上一周期提升 ${input.scoreDelta} 分，执行节奏正在改善。`;
  }

  if (input.trendDirection === "down") {
    return `较上一周期下降 ${Math.abs(input.scoreDelta)} 分，需要缩小近期任务颗粒度。`;
  }

  return "与上一周期基本持平，应继续观察完成质量和投入稳定性。";
}

function buildRecommendations(input: ReportNarrativeInput) {
  if (!input.snapshotCount) {
    return ["先生成每日健康快照，再评估趋势。", "本周至少完成 3 次带证据的任务复盘。"];
  }

  const recommendations = ["保留一个最小每日动作，优先保证连续执行。"];

  if (input.riskCounts.danger > 0) {
    recommendations.push("从危险状态日期中选择一个主要偏差，生成并完成救援任务。");
  } else if (input.riskCounts.warning > 0) {
    recommendations.push("把预警日期的任务拆分为 20 分钟以内的小任务。");
  } else {
    recommendations.push("维持当前任务强度，并提高打卡证据的可验证性。");
  }

  if (input.trendDirection === "down") {
    recommendations.push("下个周期将每日计划时长降低约 20%，三天后再评估恢复情况。");
  }

  return recommendations;
}

function riskLabel(level: ReportNarrativeInput["dominantRiskLevel"]) {
  return {
    stable: "稳定",
    warning: "预警",
    danger: "危险",
    no_data: "暂无数据"
  }[level];
}
