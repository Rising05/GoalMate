import { EmailLog } from "@prisma/client";
import { MailSendOptions, MailSendResult } from "./mail-provider";

export const WECHAT_PROVIDER = "WECHAT_PROVIDER";

export interface WechatProvider {
  readonly name: string;
  send(log: EmailLog, options?: MailSendOptions): Promise<MailSendResult>;
}
