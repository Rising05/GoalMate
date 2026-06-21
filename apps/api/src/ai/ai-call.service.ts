import { createHash } from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AiJsonCall, AiProviderError } from "./ai-call.types";
import { TraceContextService } from "../observability/trace-context.service";

@Injectable()
export class AiCallService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(TraceContextService) private readonly traces: TraceContextService = new TraceContextService()
  ) {}

  get provider() {
    return "deepseek";
  }

  get model() {
    return process.env.DEEPSEEK_MODEL || "deepseek-chat";
  }

  isConfigured() {
    return Boolean(process.env.DEEPSEEK_API_KEY?.trim());
  }

  async completeJson<T>(call: AiJsonCall<T>): Promise<T> {
    const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
    const startedAt = Date.now();
    const inputText = JSON.stringify(call.input);
    const inputHash = createHash("sha256").update(inputText).digest("hex");
    let requestId: string | undefined;
    let usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } = {};

    try {
      if (!apiKey) {
        throw new AiProviderError("DeepSeek API key is not configured", "CONFIGURATION", false);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), call.timeoutMs ?? 30_000);
      let response: Response;
      try {
        response = await fetch(process.env.DEEPSEEK_API_URL || "https://api.deepseek.com/chat/completions", {
          method: "POST",
          signal: controller.signal,
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: this.model,
            temperature: call.temperature ?? 0.2,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: call.systemPrompt },
              { role: "user", content: inputText }
            ]
          })
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new AiProviderError("DeepSeek request timed out", "TIMEOUT", true);
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }

      requestId = response.headers.get("x-request-id") ?? undefined;
      if (!response.ok) {
        const category = response.status === 429 ? "RATE_LIMIT" : "PROVIDER_HTTP";
        throw new AiProviderError(`DeepSeek request failed: ${response.status}`, category, response.status === 429 || response.status >= 500, response.status);
      }

      const payload = await response.json() as {
        id?: string;
        choices?: Array<{ message?: { content?: string } }>;
        usage?: typeof usage;
      };
      requestId ||= payload.id;
      usage = payload.usage ?? {};
      const content = payload.choices?.[0]?.message?.content;
      if (!content?.trim()) {
        throw new AiProviderError("DeepSeek returned an empty response", "EMPTY_RESPONSE", true);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(content.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, ""));
      } catch {
        throw new AiProviderError("DeepSeek returned invalid JSON", "INVALID_JSON", true);
      }

      let result: T;
      try {
        result = call.validate(parsed);
      } catch (error) {
        throw new AiProviderError(error instanceof Error ? error.message : "DeepSeek response schema is invalid", "SCHEMA_VALIDATION", true);
      }
      await this.writeLog(call, inputHash, startedAt, "SUCCEEDED", requestId, usage);
      return result;
    } catch (error) {
      const normalized = error instanceof AiProviderError
        ? error
        : new AiProviderError(error instanceof Error ? error.message : "Unknown AI provider error", "UNKNOWN", false);
      await this.writeLog(call, inputHash, startedAt, "FAILED", requestId, usage, normalized);
      throw normalized;
    }
  }

  private async writeLog<T>(call: AiJsonCall<T>, inputHash: string, startedAt: number, status: string, requestId?: string, usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } = {}, error?: AiProviderError) {
    const promptTokens = usage.prompt_tokens;
    const completionTokens = usage.completion_tokens;
    const costMicros = promptTokens == null && completionTokens == null ? undefined : Math.round((promptTokens ?? 0) * Number(process.env.DEEPSEEK_INPUT_COST_MICROS_PER_TOKEN || 0.14) + (completionTokens ?? 0) * Number(process.env.DEEPSEEK_OUTPUT_COST_MICROS_PER_TOKEN || 0.28));
    const jobTraceId = !call.context.traceId && !this.traces.getTraceId() && call.context.aiJobId
      ? (await this.prisma.aiJob.findUnique({ where: { id: call.context.aiJobId }, select: { traceId: true } }))?.traceId
      : undefined;
    await this.prisma.aiCallLog.create({
      data: {
        userId: call.context.userId,
        goalId: call.context.goalId,
        aiJobId: call.context.aiJobId,
        traceId: call.context.traceId ?? this.traces.getTraceId() ?? jobTraceId,
        capability: call.capability,
        provider: this.provider,
        model: this.model,
        promptVersion: call.promptVersion,
        inputHash,
        requestId,
        status,
        promptTokens,
        completionTokens,
        totalTokens: usage.total_tokens,
        latencyMs: Date.now() - startedAt,
        estimatedCostMicros: costMicros,
        attempt: call.context.attempt ?? 1,
        errorCategory: error?.category,
        error: error?.message.slice(0, 2000),
        fallbackUsed: call.context.fallbackUsed ?? false
      }
    });
  }
}
