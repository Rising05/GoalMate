import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { loadEnv } from "../config/load-env";
import { PrismaService } from "../prisma/prisma.service";
import { AiCallService } from "./ai-call.service";
import { AiProviderError } from "./ai-call.types";

loadEnv();
const prisma = new PrismaService();
const service = new AiCallService(prisma);
const email = "ai-call-contract-integration@example.com";
let userId = "";
const originalFetch = global.fetch;
const originalKey = process.env.DEEPSEEK_API_KEY;

describe("AiCallService integration", () => {
  before(async () => {
    await prisma.user.deleteMany({ where: { email } });
    userId = (await prisma.user.create({ data: { email, passwordHash: "test" } })).id;
    process.env.DEEPSEEK_API_KEY = "integration-test-key";
  });

  after(async () => {
    global.fetch = originalFetch;
    if (originalKey == null) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
    await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
  });

  it("validates JSON and records request metadata without raw input", async () => {
    global.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      assert.match(body.messages[1].content, /private evidence/);
      return new Response(JSON.stringify({
        id: "provider-request-1",
        choices: [{ message: { content: "{\"answer\":\"ok\"}" } }],
        usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }
      }), { status: 200, headers: { "x-request-id": "header-request-1" } });
    };

    const result = await service.completeJson({
      capability: "CONTRACT_TEST",
      promptVersion: "contract.v1",
      systemPrompt: "Return JSON",
      input: { note: "private evidence" },
      context: { userId, attempt: 2 },
      validate: (value) => {
        const item = value as { answer?: unknown };
        if (item.answer !== "ok") throw new Error("answer is invalid");
        return { answer: item.answer };
      }
    });

    assert.deepEqual(result, { answer: "ok" });
    const log = await prisma.aiCallLog.findFirstOrThrow({ where: { userId, capability: "CONTRACT_TEST" }, orderBy: { createdAt: "desc" } });
    assert.equal(log.status, "SUCCEEDED");
    assert.equal(log.requestId, "header-request-1");
    assert.equal(log.totalTokens, 14);
    assert.equal(log.attempt, 2);
    assert.equal(log.inputHash.length, 64);
    assert.equal(JSON.stringify(log).includes("private evidence"), false);
  });

  it("rejects invalid provider output and records the schema category", async () => {
    global.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "{\"answer\":1}" } }] }), { status: 200 });
    await assert.rejects(
      service.completeJson({
        capability: "INVALID_SCHEMA_TEST",
        promptVersion: "contract.v1",
        systemPrompt: "Return JSON",
        input: {},
        context: { userId },
        validate: () => { throw new Error("answer must be a string"); }
      }),
      (error: unknown) => error instanceof AiProviderError && error.category === "SCHEMA_VALIDATION"
    );
    const log = await prisma.aiCallLog.findFirstOrThrow({ where: { userId, capability: "INVALID_SCHEMA_TEST" } });
    assert.equal(log.status, "FAILED");
    assert.equal(log.errorCategory, "SCHEMA_VALIDATION");
  });

  it("classifies rate limits as retryable", async () => {
    global.fetch = async () => new Response("rate limited", { status: 429 });
    await assert.rejects(
      service.completeJson({ capability: "RATE_LIMIT_TEST", promptVersion: "contract.v1", systemPrompt: "Return JSON", input: {}, context: { userId }, validate: (value) => value }),
      (error: unknown) => error instanceof AiProviderError && error.category === "RATE_LIMIT" && error.retryable
    );
  });

  it("classifies empty responses", async () => {
    global.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 });
    await assert.rejects(
      service.completeJson({ capability: "EMPTY_TEST", promptVersion: "contract.v1", systemPrompt: "Return JSON", input: {}, context: { userId }, validate: (value) => value }),
      (error: unknown) => error instanceof AiProviderError && error.category === "EMPTY_RESPONSE"
    );
  });

  it("aborts timed out responses", async (_context) => {
    global.fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
    await assert.rejects(
      service.completeJson({ capability: "TIMEOUT_TEST", promptVersion: "contract.v1", systemPrompt: "Return JSON", input: {}, context: { userId }, timeoutMs: 5, validate: (value) => value }),
      (error: unknown) => error instanceof AiProviderError && error.category === "TIMEOUT"
    );
  });
});
