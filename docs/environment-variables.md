# GoalMate 环境变量清单

> 标注: ✅ 必填 | ⚠️ 生产必填 | 🔧 可选 | 🧪 仅开发/测试

## 核心服务

| 变量 | 级别 | 说明 |
| --- | --- | --- |
| `NODE_ENV` | ✅ | `development` / `staging` / `production` |
| `DATABASE_URL` | ✅ | MySQL 连接字符串 |
| `REDIS_URL` | ✅ | Redis 连接字符串 |
| `SESSION_SECRET` | ✅ | 会话加密密钥 (≥32 字符) |
| `API_PORT` | 🔧 | API 端口 (默认 3000) |
| `WEB_ORIGIN` | ✅ | Web 前端域名，用于 CORS |

## AI Provider (DeepSeek)

| 变量 | 级别 | 说明 |
| --- | --- | --- |
| `AI_PROVIDER` | ⚠️ | `deepseek` 或 `mock`。生产设为 `deepseek` |
| `DEEPSEEK_API_KEY` | ⚠️ | DeepSeek API 密钥 |
| `DEEPSEEK_MODEL` | 🔧 | 模型名 (默认 `deepseek-chat`) |
| `DEEPSEEK_API_URL` | 🔧 | API 地址 |
| `DEEPSEEK_INPUT_COST_MICROS_PER_TOKEN` | 🔧 | 输入 token 单价 (微美元) |
| `DEEPSEEK_OUTPUT_COST_MICROS_PER_TOKEN` | 🔧 | 输出 token 单价 |

## 加密

| 变量 | 级别 | 说明 |
| --- | --- | --- |
| `FIELD_ENCRYPTION_KEYS` | ⚠️ | JSON: `{"v1":"<32-char-key>","v2":"..."}` |
| `FIELD_ENCRYPTION_ACTIVE_VERSION` | ⚠️ | 当前活跃密钥版本 |
| `FIELD_ENCRYPTION_HASH_SECRET` | ⚠️ | HMAC blind index 密钥 |
| `UPLOAD_SIGNING_SECRET` | ⚠️ | 上传签名密钥 |

## 队列与 Worker

| 变量 | 级别 | 说明 |
| --- | --- | --- |
| `BULLMQ_ENABLED` | ⚠️ | 启用 BullMQ 队列 (生产必须) |
| `BULLMQ_WORKERS_ENABLED` | ⚠️ | 启用 Worker 消费 |
| `CHECKIN_SCORING_ASYNC` | ⚠️ | 异步评分 |
| `SCORE_APPEAL_ASYNC` | ⚠️ | 异步申诉处理 |
| `RESCUE_TASK_ASYNC` | ⚠️ | 异步救援任务 |
| `FAILURE_REPORT_ASYNC` | ⚠️ | 异步失败报告 |
| `QUEUE_RECONCILIATION_ENABLED` | 🔧 | Job 补偿扫描开关 |
| `QUEUE_RECONCILIATION_INTERVAL_MS` | 🔧 | 补偿间隔 (默认 60000) |
| `QUEUE_RECONCILIATION_GRACE_MS` | 🔧 | 补偿宽限期 |

## 提醒

| 变量 | 级别 | 说明 |
| --- | --- | --- |
| `NOTIFICATIONS_SCHEDULER_ENABLED` | ⚠️ | 自动提醒调度 |
| `NOTIFICATIONS_SCHEDULER_INTERVAL_MS` | 🔧 | 扫描间隔 |

## 邮件

| 变量 | 级别 | 说明 |
| --- | --- | --- |
| `MAIL_FROM` | ⚠️ | 发件人地址 |
| `MAIL_PROVIDER` | ⚠️ | `resend` / `mock` |
| `RESEND_API_KEY` | ⚠️ | Resend API 密钥 |
| `RESEND_API_URL` | 🔧 | Resend API 地址 |

## 微信

| 变量 | 级别 | 说明 |
| --- | --- | --- |
| `WECHAT_PROVIDER` | 🔧 | `wechat` / `mock` |
| `WECHAT_APP_ID` | 🔧 | 公众号 AppID |
| `WECHAT_APP_SECRET` | 🔧 | 公众号 AppSecret |
| `WECHAT_TEMPLATE_ID` | 🔧 | 模板消息 ID |
| `WECHAT_MINIPROGRAM_APP_ID` | ⚠️ | 小程序 AppID (P4 必填) |
| `WECHAT_MINIPROGRAM_APP_SECRET` | ⚠️ | 小程序 AppSecret |
| `WECHAT_MINIPROGRAM_MOCK_CODES` | 🧪 | 测试环境启用 mock code |
| `WECHAT_MINIPROGRAM_PAGE` | 🔧 | 小程序跳转页面 |
| `WECHAT_MINIPROGRAM_STATE` | 🔧 | 小程序版本状态 |

## 文件存储

| 变量 | 级别 | 说明 |
| --- | --- | --- |
| `UPLOAD_STORAGE_PROVIDER` | ⚠️ | `S3` / `LOCAL` (生产必须 S3) |
| `UPLOAD_STORAGE_PATH` | 🔧 | 本地存储路径 |
| `UPLOAD_SCAN_ASYNC` | ⚠️ | 异步病毒扫描 |
| `UPLOAD_CLEANUP_ENABLED` | 🔧 | 过期文件清理 |
| `S3_BUCKET` | ⚠️ | S3 Bucket 名称 |
| `S3_REGION` | ⚠️ | S3 区域 |
| `S3_ENDPOINT` | 🔧 | 自定义 S3 endpoint |
| `S3_ACCESS_KEY_ID` | ⚠️ | S3 Access Key |
| `S3_SECRET_ACCESS_KEY` | ⚠️ | S3 Secret Key |
| `S3_FORCE_PATH_STYLE` | 🔧 | 路径风格 |
| `UPLOAD_URL_TTL_SECONDS` | 🔧 | 签名 URL 有效期 |
| `FILE_SCANNER_PROVIDER` | ⚠️ | `CLAMAV` / `MOCK` |
| `CLAMAV_HOST` | ⚠️ | ClamAV 主机 |
| `CLAMAV_PORT` | ⚠️ | ClamAV 端口 |
| `CLAMAV_TIMEOUT_MS` | 🔧 | 扫描超时 |

## 支付

| 变量 | 级别 | 说明 |
| --- | --- | --- |
| `MOCK_PAYMENT_WEBHOOK_SECRET` | 🧪 | Mock 支付密钥 |
| `MOCK_PAYMENT_CHECKOUT_URL` | 🧪 | Mock 结算页 |
| `STRIPE_WEBHOOK_SECRET` | ⚠️ | Stripe Webhook 签名密钥 |
| `STRIPE_CHECKOUT_URL` | ⚠️ | Stripe Checkout 密钥 |
| `WECHAT_PAY_WEBHOOK_SECRET` | ⚠️ | 微信支付 Webhook 密钥 |
| `WECHAT_PAY_CHECKOUT_URL` | ⚠️ | 微信支付 URL |

## 可观测性

| 变量 | 级别 | 说明 |
| --- | --- | --- |
| `METRICS_TOKEN` | ⚠️ | Prometheus metrics 访问令牌 |

## Feature Flags

生产环境推荐使用环境变量控制以下高风险能力：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `FF_REAL_AI` | false | 真实 AI Provider |
| `FF_AUTO_REMINDERS` | false | 自动提醒调度 |
| `FF_REAL_PAYMENT` | false | 真实支付（非 Mock） |
| `FF_WECHAT_LOGIN` | false | 微信小程序登录 |
| `FF_UPLOAD_SCAN` | false | 病毒扫描 |
