import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EmailLog } from "@prisma/client";
import { ResendMailProvider } from "./resend-mail.provider";
import { WechatSubscribeProvider } from "./wechat-subscribe.provider";

describe("Notification provider integration", () => {
  it("sends a Resend email and returns the provider message id", async () => {
    const restore = captureEnvironment([
      "RESEND_API_KEY",
      "MAIL_FROM",
      "RESEND_API_URL"
    ]);
    const originalFetch = globalThis.fetch;
    process.env.RESEND_API_KEY = "resend-test-key";
    process.env.MAIL_FROM = "GoalMate <no-reply@example.com>";
    process.env.RESEND_API_URL = "https://resend.test/emails";
    let requestBody: Record<string, unknown> | null = null;

    globalThis.fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: "resend-message-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    };

    try {
      const result = await new ResendMailProvider().send(buildLog("EMAIL"));
      const sentRequest = requestBody as Record<string, unknown> | null;

      assert.equal(result.status, "SENT");
      assert.equal(result.providerMessageId, "resend-message-1");
      assert.ok(sentRequest);
      assert.deepEqual(sentRequest.to, ["student@example.com"]);
      assert.equal(sentRequest.subject, "今日任务提醒");
      assert.match(String(sentRequest.html), /完成一个最小任务/);
    } finally {
      globalThis.fetch = originalFetch;
      restore();
    }
  });

  it("classifies permanent Resend errors as non-retryable", async () => {
    const restore = captureEnvironment(["RESEND_API_KEY", "MAIL_FROM"]);
    const originalFetch = globalThis.fetch;
    process.env.RESEND_API_KEY = "resend-test-key";
    process.env.MAIL_FROM = "no-reply@example.com";
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ message: "Invalid recipient" }), {
        status: 422,
        headers: { "Content-Type": "application/json" }
      });

    try {
      const result = await new ResendMailProvider().send(buildLog("EMAIL"));

      assert.equal(result.status, "FAILED");
      assert.equal(result.errorCode, "RESEND_HTTP_422");
      assert.equal(result.retryable, false);
    } finally {
      globalThis.fetch = originalFetch;
      restore();
    }
  });

  it("caches the WeChat token and sends subscription message payloads", async () => {
    const restore = captureEnvironment([
      "WECHAT_APP_ID",
      "WECHAT_APP_SECRET",
      "WECHAT_TEMPLATE_ID",
      "WECHAT_API_BASE_URL"
    ]);
    const originalFetch = globalThis.fetch;
    process.env.WECHAT_APP_ID = "wechat-app-id";
    process.env.WECHAT_APP_SECRET = "wechat-secret";
    process.env.WECHAT_TEMPLATE_ID = "template-default";
    process.env.WECHAT_API_BASE_URL = "https://wechat.test";
    let tokenRequests = 0;
    const messageBodies: Array<Record<string, unknown>> = [];

    globalThis.fetch = async (input, init) => {
      const url = String(input);

      if (url.includes("/cgi-bin/token")) {
        tokenRequests += 1;
        return new Response(
          JSON.stringify({ access_token: "wechat-token", expires_in: 7200 }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      messageBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ errcode: 0, errmsg: "ok", msgid: 9527 }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    };

    try {
      const provider = new WechatSubscribeProvider();
      const first = await provider.send(buildLog("WECHAT"));
      const second = await provider.send(buildLog("WECHAT"));

      assert.equal(first.status, "SENT");
      assert.equal(first.providerMessageId, "9527");
      assert.equal(second.status, "SENT");
      assert.equal(tokenRequests, 1);
      assert.equal(messageBodies.length, 2);
      assert.equal(messageBodies[0].touser, "openid-test-user");
      assert.equal(messageBodies[0].template_id, "template-default");
      assert.ok(messageBodies[0].data);
    } finally {
      globalThis.fetch = originalFetch;
      restore();
    }
  });
});

function buildLog(channel: "EMAIL" | "WECHAT"): EmailLog {
  const now = new Date("2026-06-18T09:00:00.000+08:00");

  return {
    id: `notification-provider-${channel.toLowerCase()}`,
    traceId: null,
    userId: "user-test",
    goalId: "goal-test",
    channel,
    type: "DAILY_TASK",
    recipientEmail:
      channel === "EMAIL" ? "student@example.com" : "openid-test-user",
    subject: "今日任务提醒",
    content: "今天先完成一个最小任务。",
    status: "QUEUED",
    attempts: 0,
    provider: null,
    providerMessageId: null,
    errorCode: null,
    error: null,
    source: "MANUAL",
    schedulerRunId: null,
    dedupeKey: null,
    skipReason: null,
    scheduledFor: now,
    sentAt: null,
    createdAt: now,
    updatedAt: now
  };
}

function captureEnvironment(keys: string[]) {
  const values = new Map(keys.map((key) => [key, process.env[key]]));

  return () => {
    for (const [key, value] of values) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}
