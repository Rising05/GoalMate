import { EmailLog } from "@prisma/client";

export const MAIL_PROVIDER = "MAIL_PROVIDER";

export interface MailSendOptions {
  simulateFailure?: boolean;
}

export interface MailSendResult {
  status: "SENT" | "FAILED";
  error: string | null;
}

export interface MailProvider {
  readonly name: string;
  send(log: EmailLog, options?: MailSendOptions): Promise<MailSendResult>;
}
