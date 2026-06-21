import { Inject, Injectable } from "@nestjs/common";
import {
  GeneratedReportNarrative,
  ReportNarrativeInput,
  ReportNarrativeProvider
} from "./report-narrative.provider";
import { AiCallService } from "../ai/ai-call.service";
import { AiCallContext } from "../ai/ai-call.types";
import { AI_PROMPTS } from "../ai/ai-prompts";

@Injectable()
export class DeepSeekReportNarrativeProvider implements ReportNarrativeProvider {
  readonly name = "deepseek";

  constructor(@Inject(AiCallService) private readonly ai: AiCallService) {}

  get model() {
    return this.ai.model;
  }

  isConfigured() {
    return this.ai.isConfigured();
  }

  async generate(input: ReportNarrativeInput, context?: AiCallContext): Promise<GeneratedReportNarrative> {
    if (!context) throw new Error("AI call context is required for report generation");
    return this.ai.completeJson({
      capability: "REPORT_NARRATIVE",
      promptVersion: AI_PROMPTS.report.version,
      systemPrompt: AI_PROMPTS.report.system,
      input,
      context,
      validate: (value) => this.parseNarrative(value)
    });
  }

  private parseNarrative(value: unknown): GeneratedReportNarrative {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("DeepSeek report response must be an object");
    }
    const parsed = value as Record<string, unknown>;
    const title = this.requireString(parsed.title, "title");
    const summary = this.requireString(parsed.summary, "summary");
    const body = this.requireString(parsed.body, "body");

    if (!Array.isArray(parsed.recommendations)) {
      throw new Error("DeepSeek report field recommendations must be an array");
    }

    const recommendations = parsed.recommendations.map((item, index) =>
      this.requireString(item, `recommendations[${index}]`)
    );

    if (recommendations.length < 2 || recommendations.length > 4) {
      throw new Error("DeepSeek report recommendations must contain 2-4 items");
    }

    return { title, summary, body, recommendations };
  }

  private requireString(value: unknown, field: string) {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`DeepSeek report field ${field} must be a string`);
    }

    return value.trim();
  }
}
