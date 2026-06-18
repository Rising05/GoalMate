import { Injectable } from "@nestjs/common";
import { EmailLog } from "@prisma/client";
import { MailSendOptions } from "./mail-provider";
import { WechatProvider } from "./wechat-provider";

@Injectable()
export class MockWechatProvider implements WechatProvider {
  readonly name = "mock-wechat";

  async send(log: EmailLog, options: MailSendOptions = {}) {
    const shouldFail =
      options.simulateFailure || log.content.includes("[[mock-wechat-fail]]");

    if (shouldFail) {
      return {
        status: "FAILED" as const,
        error: "Mock WeChat provider failed",
        errorCode: "MOCK_WECHAT_FAILURE",
        providerMessageId: null,
        retryable: true
      };
    }

    return {
      status: "SENT" as const,
      error: null,
      errorCode: null,
      providerMessageId: `mock-wechat-${log.id}`,
      retryable: false
    };
  }
}
