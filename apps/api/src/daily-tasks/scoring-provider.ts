import { DailyTask } from "@prisma/client";

export const SCORING_PROVIDER = "SCORING_PROVIDER";

export interface ScoreInput {
  content: string;
  investedMinutes: number;
  task: DailyTask;
}

export interface ScoreResult {
  totalScore: number;
  dimensions: Record<string, number>;
  evidence: Record<string, unknown>;
  summary: string;
  suggestion: string;
}

export interface ScoringProvider {
  readonly name: string;
  score(input: ScoreInput): ScoreResult | Promise<ScoreResult>;
}
