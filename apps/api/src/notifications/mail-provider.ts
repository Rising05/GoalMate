import { EmailLog } from "@prisma/client";

export const MAIL_PROVIDER = "MAIL_PROVIDER";

export interface MailSendOptions {
  simulateFailure?: boolean;
}

export interface MailSendResult {
  status: "SENT" | "FAILED";
  error: string | null;
  errorCode?: string | null;
  providerMessageId?: string | null;
  retryable?: boolean;
}

export interface MailProvider {
  readonly name: string;
  send(log: EmailLog, options?: MailSendOptions): Promise<MailSendResult>;
}
