import { Inject, Injectable } from "@nestjs/common";
import { AiCallService } from "../ai/ai-call.service";
import { AI_PROMPTS } from "../ai/ai-prompts";
import { AiCallContext } from "../ai/ai-call.types";
import { ScoreInput, ScoreResult, ScoringProvider } from "./scoring-provider";

@Injectable()
export class DeepSeekScoringProvider implements ScoringProvider {
  readonly name = "deepseek";
  constructor(@Inject(AiCallService) private readonly ai: AiCallService) {}
  isConfigured() { return this.ai.isConfigured(); }

  score(input: ScoreInput, context?: AiCallContext): Promise<ScoreResult> {
    if (!context) throw new Error("AI call context is required for scoring");
    const { task, ...evidence } = input;
    return this.ai.completeJson({
      capability: "CHECKIN_SCORING",
      promptVersion: AI_PROMPTS.scoring.version,
      systemPrompt: AI_PROMPTS.scoring.system,
      context,
      input: {
        ...evidence,
        task: { id: task.id, title: task.title, description: task.description, taskType: task.taskType, plannedMinutes: task.plannedMinutes, questionCount: task.questionCount, targetAccuracy: task.targetAccuracy }
      },
      validate: validateScore
    });
  }
}

function validateScore(value: unknown): ScoreResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Score response must be an object");
  const item = value as Record<string, unknown>;
  if (!item.dimensions || typeof item.dimensions !== "object" || Array.isArray(item.dimensions)) throw new Error("dimensions must be an object");
  const keys = ["completion", "timeMatch", "evidence", "questionAccuracy", "reflection", "studyQuality"] as const;
  const rawDimensions = item.dimensions as Record<string, unknown>;
  if (Object.keys(rawDimensions).length !== keys.length || keys.some((key) => !(key in rawDimensions))) throw new Error("dimensions must contain the fixed six-dimension rubric");
  const evidenceByDimension: Record<string, string[]> = {};
  const dimensions: Record<string, number> = {};
  for (const key of keys) {
    const dimension = rawDimensions[key];
    if (!dimension || typeof dimension !== "object" || Array.isArray(dimension)) throw new Error(`dimensions.${key} must be an object`);
    const data = dimension as Record<string, unknown>;
    dimensions[key] = boundedScore(data.score, `dimensions.${key}.score`);
    if (!Array.isArray(data.evidence) || data.evidence.length > 5 || data.evidence.some((entry) => typeof entry !== "string" || !entry.trim() || entry.length > 300)) throw new Error(`dimensions.${key}.evidence must contain at most 5 strings`);
    evidenceByDimension[key] = (data.evidence as string[]).map((entry) => entry.trim());
  }
  const weights: Record<(typeof keys)[number], number> = { completion: 0.3, timeMatch: 0.15, evidence: 0.2, questionAccuracy: 0.1, reflection: 0.1, studyQuality: 0.15 };
  const totalScore = Math.round(keys.reduce((total, key) => total + dimensions[key] * weights[key], 0));
  return { totalScore, dimensions, evidence: { source: "deepseek", rubricVersion: "checkin-score.v1", dimensions: evidenceByDimension }, summary: requiredString(item.summary, "summary"), suggestion: requiredString(item.suggestion, "suggestion") };
}

function boundedScore(value: unknown, field: string) { const score = Number(value); if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error(`${field} must be between 0 and 100`); return Math.round(score); }
function requiredString(value: unknown, field: string) { if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a string`); return value.trim(); }
