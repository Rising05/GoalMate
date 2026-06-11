import { Injectable } from "@nestjs/common";
import { EmailLog } from "@prisma/client";
import { MailProvider, MailSendOptions } from "./mail-provider";

@Injectable()
export class MockMailProvider implements MailProvider {
  readonly name = "mock-mail";

  async send(log: EmailLog, options: MailSendOptions = {}) {
    const shouldFail =
      options.simulateFailure ||
      log.recipientEmail.includes("+fail") ||
      log.content.includes("[[mock-email-fail]]");

    if (shouldFail) {
      return {
        status: "FAILED" as const,
        error: "Mock email provider failed"
      };
    }

    return {
      status: "SENT" as const,
      error: null
    };
  }
}
