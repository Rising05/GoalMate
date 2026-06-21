import { Goal } from "@prisma/client";
import { GeneratedGoalPlan } from "./mock-plan.provider";
import { AiCallContext } from "../ai/ai-call.types";

export const PLAN_PROVIDER = "PLAN_PROVIDER";

export interface PlanProvider {
  readonly name: string;
  generate(goal: Goal, context?: AiCallContext): GeneratedGoalPlan | Promise<GeneratedGoalPlan>;
}
