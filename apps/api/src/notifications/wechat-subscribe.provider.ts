import { Injectable } from "@nestjs/common";
import { EmailLog } from "@prisma/client";
import { MailSendOptions } from "./mail-provider";
import { WechatProvider } from "./wechat-provider";

@Injectable()
export class WechatSubscribeProvider implements WechatProvider {
  readonly name = "wechat-subscribe";
  private accessToken: { value: string; expiresAt: number } | null = null;

  isConfigured() {
    return Boolean(
      process.env.WECHAT_APP_ID?.trim() &&
      process.env.WECHAT_APP_SECRET?.trim() &&
      (process.env.WECHAT_TEMPLATE_ID?.trim() ||
        Object.keys(process.env).some((key) => key.startsWith("WECHAT_TEMPLATE_ID_")))
    );
  }

  async send(log: EmailLog, options: MailSendOptions = {}) {
    if (options.simulateFailure) {
      return failure(
        "Simulated WeChat delivery failure",
        "WECHAT_SIMULATED_FAILURE",
        true
      );
    }

    const templateId =
      process.env[`WECHAT_TEMPLATE_ID_${log.type}`]?.trim() ||
      process.env.WECHAT_TEMPLATE_ID?.trim();

    if (!this.isConfigured() || !templateId) {
      return failure(
        "WeChat subscribe provider is not configured for this reminder type",
        "WECHAT_NOT_CONFIGURED",
        false
      );
    }

    try {
      const token = await this.getAccessToken();
      const baseUrl = process.env.WECHAT_API_BASE_URL?.trim() || "https://api.weixin.qq.com";
      const response = await fetch(
        `${baseUrl}/cgi-bin/message/subscribe/send?access_token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            touser: log.recipientEmail,
            template_id: templateId,
            page: process.env.WECHAT_MINIPROGRAM_PAGE?.trim() || "pages/index/index",
            miniprogram_state:
              process.env.WECHAT_MINIPROGRAM_STATE?.trim() || "formal",
            lang: "zh_CN",
            data: this.buildTemplateData(log)
          })
        }
      );
      const payload = await readJson(response);
      const errorCode = Number(payload.errcode ?? (response.ok ? 0 : response.status));

      if (!response.ok || errorCode !== 0) {
        if ([40001, 40014, 42001].includes(errorCode)) {
          this.accessToken = null;
        }

        return failure(
          typeof payload.errmsg === "string"
            ? payload.errmsg
            : `WeChat request failed: ${response.status}`,
          `WECHAT_${errorCode}`,
          response.status >= 500 || [40001, 40014, 42001, 45009].includes(errorCode)
        );
      }

      return {
        status: "SENT" as const,
        error: null,
        errorCode: null,
        providerMessageId:
          typeof payload.msgid === "string" || typeof payload.msgid === "number"
            ? String(payload.msgid)
            : null,
        retryable: false
      };
    } catch (error) {
      return failure(
        error instanceof Error ? error.message : "WeChat network failure",
        "WECHAT_NETWORK_ERROR",
        true
      );
    }
  }

  private async getAccessToken() {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) {
      return this.accessToken.value;
    }

    const appId = process.env.WECHAT_APP_ID?.trim();
    const appSecret = process.env.WECHAT_APP_SECRET?.trim();

    if (!appId || !appSecret) {
      throw new Error("WeChat app credentials are not configured");
    }

    const baseUrl = process.env.WECHAT_API_BASE_URL?.trim() || "https://api.weixin.qq.com";
    const response = await fetch(
      `${baseUrl}/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`
    );
    const payload = await readJson(response);
    const token = typeof payload.access_token === "string" ? payload.access_token : "";

    if (!response.ok || !token) {
      throw new Error(
        typeof payload.errmsg === "string"
          ? payload.errmsg
          : `WeChat access token failed: ${response.status}`
      );
    }

    const expiresIn = Number(payload.expires_in ?? 7200);
    this.accessToken = {
      value: token,
      expiresAt: Date.now() + Math.max(300, expiresIn) * 1000
    };

    return token;
  }

  private buildTemplateData(log: EmailLog) {
    const titleField = process.env.WECHAT_TEMPLATE_TITLE_FIELD?.trim() || "thing1";
    const contentField = process.env.WECHAT_TEMPLATE_CONTENT_FIELD?.trim() || "thing2";
    const timeField = process.env.WECHAT_TEMPLATE_TIME_FIELD?.trim() || "time3";

    return {
      [titleField]: { value: log.subject.slice(0, 20) },
      [contentField]: { value: log.content.replace(/\s+/g, " ").slice(0, 20) },
      [timeField]: {
        value: new Intl.DateTimeFormat("zh-CN", {
          timeZone: "Asia/Shanghai",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false
        }).format(log.scheduledFor ?? new Date())
      }
    };
  }
}

function failure(error: string, errorCode: string, retryable: boolean) {
  return {
    status: "FAILED" as const,
    error,
    errorCode,
    providerMessageId: null,
    retryable
  };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = await response.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
