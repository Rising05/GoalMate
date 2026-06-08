export const GOALMATE_APP_NAME = "GoalPilot AI";

export type GoalCategory = "study" | "career" | "fitness" | "habit" | "custom";

export type GoalStatus =
  | "draft"
  | "generating_plan"
  | "waiting_confirmation"
  | "active"
  | "at_risk"
  | "replanning"
  | "completed"
  | "failed"
  | "generation_failed";

export type CheckinStatus =
  | "pending"
  | "submitted"
  | "scoring"
  | "scored"
  | "score_failed"
  | "appealing"
  | "rescored"
  | "appeal_rejected";

export type ScoreDimension =
  | "task_completion"
  | "time_investment"
  | "quality"
  | "goal_relevance"
  | "reflection_depth"
  | "consistency";

export interface ScoreRubricItem {
  dimension: ScoreDimension;
  label: string;
  description: string;
  maxScore: number;
}

export const DAILY_SCORE_RUBRIC: ScoreRubricItem[] = [
  {
    dimension: "task_completion",
    label: "Task completion",
    description: "How much of the planned task was actually completed.",
    maxScore: 100
  },
  {
    dimension: "time_investment",
    label: "Time investment",
    description: "How closely actual time matched the planned effort.",
    maxScore: 100
  },
  {
    dimension: "quality",
    label: "Completion quality",
    description: "Evidence of meaningful progress and output quality.",
    maxScore: 100
  },
  {
    dimension: "goal_relevance",
    label: "Goal relevance",
    description: "Whether the work directly supports the long-term goal.",
    maxScore: 100
  },
  {
    dimension: "reflection_depth",
    label: "Reflection depth",
    description: "Specificity and usefulness of the daily review.",
    maxScore: 100
  },
  {
    dimension: "consistency",
    label: "Consistency",
    description: "Whether the user preserved execution continuity.",
    maxScore: 100
  }
];

