import { Controller, Get } from "@nestjs/common";

const LEGAL_DOCUMENTS = {
  terms: {
    version: "terms-2026-06-23",
    title: "GoalMate 服务条款",
    updatedAt: "2026-06-23",
    sections: [
      "GoalMate 帮助用户记录目标、计划、打卡、提醒、奖励和复盘数据。",
      "用户应保证上传证据和填写内容合法、真实，不上传他人隐私、违法内容或恶意文件。",
      "会员、额度、支付和退款规则以产品页面和订单页面展示为准。",
      "账号删除会删除业务数据并安排对象存储文件删除任务；备份副本会按备份保留周期清理。"
    ]
  },
  privacy: {
    version: "privacy-2026-06-23",
    title: "GoalMate 隐私政策",
    updatedAt: "2026-06-23",
    sections: [
      "我们收集邮箱、昵称、目标、计划、打卡、上传证据、提醒设置、会员订单和必要的安全审计记录。",
      "目标描述、打卡复盘、奖励描述、微信 openId/unionId 等敏感字段采用应用层版本化加密或安全索引保护。",
      "管理员查看用户原文必须具备 SUPER_ADMIN 权限、填写原因并留下审计记录。",
      "用户可以在账号页导出个人数据或删除账号。导出数据会解密当前用户自己的内容，但不会包含密钥版本或安全索引。"
    ]
  },
  aiDisclosure: {
    version: "ai-disclosure-2026-06-23",
    title: "GoalMate AI 使用说明",
    updatedAt: "2026-06-23",
    sections: [
      "AI 仅用于目标分析、计划生成、打卡评分、申诉复评、偏差总结、救援任务、报告和失败复盘。",
      "发送给 AI 的请求只包含完成当前能力所需字段，不包含邮箱、昵称、密码、支付密钥或与任务无关的身份信息。",
      "AI 调用日志只保存输入哈希、模型、能力、状态、耗时、Token 统计和错误类别，不保存完整提示词输入。",
      "用户删除账号后，业务数据会删除；已产生的最小化 AI 调用日志按安全审计保留策略处理。"
    ]
  }
};

@Controller("legal")
export class LegalController {
  @Get()
  getAll() {
    return LEGAL_DOCUMENTS;
  }

  @Get("terms")
  getTerms() {
    return LEGAL_DOCUMENTS.terms;
  }

  @Get("privacy")
  getPrivacy() {
    return LEGAL_DOCUMENTS.privacy;
  }

  @Get("ai-disclosure")
  getAiDisclosure() {
    return LEGAL_DOCUMENTS.aiDisclosure;
  }
}
