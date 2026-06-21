export const REPORT_NARRATIVE_PROVIDER = "REPORT_NARRATIVE_PROVIDER";
import { AiCallContext } from "../ai/ai-call.types";

export interface ReportNarrativeInput {
  type: "WEEKLY_TREND" | "MONTHLY_TREND";
  goalTitle: string;
  startsOn: string;
  endsOn: string;
  snapshotCount: number;
  averageHealthScore: number | null;
  previousAverageHealthScore: number | null;
  scoreDelta: number | null;
  trendDirection: "up" | "down" | "flat" | "no_data";
  minHealthScore: number | null;
  maxHealthScore: number | null;
  dominantRiskLevel: "stable" | "warning" | "danger" | "no_data";
  riskCounts: {
    stable: number;
    warning: number;
    danger: number;
  };
  insights: string[];
}

export interface GeneratedReportNarrative {
  title: string;
  summary: string;
  body: string;
  recommendations: string[];
}

export interface ReportNarrativeProvider {
  readonly name: string;
  readonly model?: string;
  generate(
    input: ReportNarrativeInput,
    context?: AiCallContext
  ): GeneratedReportNarrative | Promise<GeneratedReportNarrative>;
}
