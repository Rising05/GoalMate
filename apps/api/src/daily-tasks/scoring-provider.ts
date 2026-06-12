import { DailyTask } from "@prisma/client";

export const SCORING_PROVIDER = "SCORING_PROVIDER";

export interface ScoreInput {
  content: string;
  investedMinutes: number;
  evidence: CheckinEvidenceInput;
  task: DailyTask;
}

export interface CheckinEvidenceInput {
  completedSubtasks: string[];
  actualQuestionCount?: number;
  correctQuestionCount?: number;
  accuracy?: number;
  evidenceFiles: string[];
  evidenceLinks: string[];
  studyMood?: string;
  difficultyLevel?: string;
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
