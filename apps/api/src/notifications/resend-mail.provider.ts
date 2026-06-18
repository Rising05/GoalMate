import { Injectable } from "@nestjs/common";
import { EmailLog } from "@prisma/client";
import { MailProvider, MailSendOptions } from "./mail-provider";

@Injectable()
export class ResendMailProvider implements MailProvider {
  readonly name = "resend";

  isConfigured() {
    return Boolean(
      process.env.RESEND_API_KEY?.trim() && process.env.MAIL_FROM?.trim()
    );
  }

  async send(log: EmailLog, options: MailSendOptions = {}) {
    if (options.simulateFailure) {
      return {
        status: "FAILED" as const,
        error: "Simulated Resend delivery failure",
        errorCode: "RESEND_SIMULATED_FAILURE",
        providerMessageId: null,
        retryable: true
      };
    }

    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.MAIL_FROM?.trim();

    if (!apiKey || !from) {
      return {
        status: "FAILED" as const,
        error: "Resend provider is not configured",
        errorCode: "RESEND_NOT_CONFIGURED",
        providerMessageId: null,
        retryable: false
      };
    }

    try {
      const response = await fetch(
        process.env.RESEND_API_URL?.trim() || "https://api.resend.com/emails",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            from,
            to: [log.recipientEmail],
            subject: log.subject,
            text: log.content,
            html: `<div style="white-space:pre-wrap;font-family:system-ui,sans-serif">${escapeHtml(log.content)}</div>`
          })
        }
      );
      const payload = await readJson(response);

      if (!response.ok) {
        return {
          status: "FAILED" as const,
          error: getProviderError(payload) || `Resend request failed: ${response.status}`,
          errorCode: `RESEND_HTTP_${response.status}`,
          providerMessageId: null,
          retryable: response.status === 429 || response.status >= 500
        };
      }

      return {
        status: "SENT" as const,
        error: null,
        errorCode: null,
        providerMessageId:
          typeof payload.id === "string" && payload.id ? payload.id : null,
        retryable: false
      };
    } catch (error) {
      return {
        status: "FAILED" as const,
        error: error instanceof Error ? error.message : "Resend network failure",
        errorCode: "RESEND_NETWORK_ERROR",
        providerMessageId: null,
        retryable: true
      };
    }
  }
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

function getProviderError(payload: Record<string, unknown>) {
  if (typeof payload.message === "string") {
    return payload.message;
  }

  if (typeof payload.error === "string") {
    return payload.error;
  }

  return null;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character] ?? character);
}
