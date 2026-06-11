import { Goal } from "@prisma/client";
import { GeneratedGoalPlan } from "./mock-plan.provider";

export const PLAN_PROVIDER = "PLAN_PROVIDER";

export interface PlanProvider {
  readonly name: string;
  generate(goal: Goal): GeneratedGoalPlan | Promise<GeneratedGoalPlan>;
}
