const text = { type: "string", minLength: 1, maxLength: 4000 } as const;
const textList = (maxItems: number) => ({ type: "array", items: text, maxItems });
const score = { type: "integer", minimum: 0, maximum: 100 } as const;

export const AI_JSON_SCHEMAS = {
  plan: {
    type: "object",
    required: ["summary", "milestones", "weeklyPlans"],
    properties: { summary: text, milestones: { type: "array", minItems: 1 }, weeklyPlans: { type: "array", minItems: 1 } }
  },
  goalAnalysis: {
    type: "object",
    required: ["structuredFields", "feasible", "riskLevel", "feasibilityScore", "reasons", "assumptions", "suggestedChanges", "questions"],
    properties: { structuredFields: { type: "object" }, feasible: { type: "boolean" }, riskLevel: { enum: ["stable", "warning", "danger"] }, feasibilityScore: score, reasons: textList(6), assumptions: textList(6), suggestedChanges: textList(6), questions: textList(3) }
  },
  scoring: {
    type: "object",
    required: ["dimensions", "summary", "suggestion"],
    properties: { dimensions: { type: "object" }, summary: text, suggestion: text }
  },
  appeal: { type: "object", required: ["accepted", "newScore", "dimensions", "evidence", "summary", "suggestion"], properties: { accepted: { type: "boolean" }, newScore: score, dimensions: { type: "object" }, evidence: { type: "object" }, summary: text, suggestion: text } },
  deviation: { type: "object", required: ["summary", "riskLevel", "recommendations"], properties: { summary: text, riskLevel: { enum: ["stable", "warning", "danger"] }, recommendations: textList(4) } },
  rescue: { type: "object", required: ["title", "description", "estimatedMinutes", "reason"], properties: { title: text, description: text, estimatedMinutes: { type: "integer", minimum: 5, maximum: 60 }, reason: text } },
  report: { type: "object", required: ["title", "summary", "body", "recommendations"], properties: { title: text, summary: text, body: text, recommendations: textList(4) } },
  failureReview: { type: "object", required: ["reasonAnalysis", "suggestion"], properties: { reasonAnalysis: text, suggestion: text } }
} as const;
