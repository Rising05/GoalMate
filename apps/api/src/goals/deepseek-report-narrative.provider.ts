import { Injectable } from "@nestjs/common";
import {
  GeneratedReportNarrative,
  ReportNarrativeInput,
  ReportNarrativeProvider
} from "./report-narrative.provider";

@Injectable()
export class DeepSeekReportNarrativeProvider implements ReportNarrativeProvider {
  readonly name = "deepseek";

  get model() {
    return process.env.DEEPSEEK_MODEL || "deepseek-chat";
  }

  isConfigured() {
    return Boolean(process.env.DEEPSEEK_API_KEY?.trim());
  }

  async generate(input: ReportNarrativeInput): Promise<GeneratedReportNarrative> {
    const apiKey = process.env.DEEPSEEK_API_KEY?.trim();

    if (!apiKey) {
      throw new Error("DeepSeek API key is not configured");
    }

    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "你是 GoalPilot 学习复盘助手。仅返回 JSON，字段为 title、summary、body、recommendations。body 必须是中文 Markdown，不能虚构输入中不存在的数据；recommendations 必须是 2-4 条可执行建议。"
          },
          {
            role: "user",
            content: JSON.stringify(input)
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`DeepSeek report generation failed: ${response.status}`);
    }

    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("DeepSeek returned an empty report narrative");
    }

    return this.parseNarrative(content);
  }

  private parseNarrative(content: string): GeneratedReportNarrative {
    const cleaned = content
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "");
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
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
