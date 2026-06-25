# GoalMate 发布 Runbook

## 发布前检查清单

- [ ] 所有 PR 通过 CI：typecheck、integration 测试、build、git diff --check
- [ ] Staging 环境 E2E 测试全部通过
- [ ] 数据库迁移已在 Staging 执行并通过
- [ ] 数据库备份已完成
- [ ] 环境变量已按 `docs/environment-variables.md` 配置
- [ ] Feature Flags 已按灰度策略设好初始值
- [ ] 监控告警已配置（Prometheus + Alertmanager）
- [ ] 回滚方案已确认

## 环境

| 环境 | 数据库 | AI | 支付 | 存储 | 扫描 | 提醒 | 微信 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Development | Docker MySQL | Mock | Mock | Local | Mock | Off | Mock |
| Staging | 云 MySQL | DeepSeek (少量) | Stripe Test | S3 | ClamAV | On | Mock |
| Production | 云 MySQL (HA) | DeepSeek | Stripe Live | S3 (私有) | ClamAV | On | 真实 |

## 发布步骤

### 1. 预发布 (Staging)

```bash
# 1. 拉取最新代码
git checkout main && git pull origin main

# 2. 备份 Staging 数据库
npm run backup:staging

# 3. 执行数据库迁移
DATABASE_URL=$STAGING_DATABASE_URL npm run prisma:migrate -w @goalmate/api

# 4. 构建
npm run build

# 5. 部署到 Staging
# (根据实际部署平台使用对应命令)
npm run deploy:staging

# 6. 运行 E2E
npm run test:e2e

# 7. 烟雾测试
# - 登录/注册
# - 创建目标 → 生成计划 → 确认
# - 今日任务 → 打卡 → 查看评分
# - 健康报告
# - 管理后台权限检查
```

### 2. 生产发布

```bash
# 1. 确认 Staging E2E 通过
# 2. 备份生产数据库
npm run backup:production

# 3. 执行数据库迁移
DATABASE_URL=$PROD_DATABASE_URL npm run prisma:migrate -w @goalmate/api

# 4. 部署
npm run deploy:production

# 5. 验证
# - 健康检查: GET /health/readiness
# - Metrics: GET /metrics
# - 核心流程: 登录 → 打卡 → 评分
```

### 3. 回滚步骤

```bash
# 1. 回滚应用代码
git revert <bad-commit> && git push origin main
npm run deploy:production

# 2. 如果涉及数据库迁移，回滚迁移
# (注意：部分迁移不可逆，需要从备份恢复)
DATABASE_URL=$PROD_DATABASE_URL npx prisma migrate diff \
  --from-migrations apps/api/prisma/migrations \
  --to-schema-datamodel apps/api/prisma/schema.prisma \
  --script > rollback.sql

# 3. 如果是数据损坏，从备份恢复
# npm run restore:production -- --backup-file=<file>
```

## 暂停条件

出现以下任一情况立即暂停发布：

- **数据错乱**：目标、任务、打卡数据不一致
- **越权访问**：用户可读取他人数据
- **重复扣费**：支付事件导致多次扣款或权益
- **提醒轰炸**：用户短时间收到大量重复提醒
- **AI 大面积失败**：超过 30% AI 调用失败
- **上传安全异常**：未扫描文件可被下载或引用

## 验证步骤

发布后立即执行：

1. 注册新账号 → 登录
2. Free 用户创建目标 → 确认策略正确
3. 完成任务打卡 → 查看评分
4. 查看健康报告 → 数据正确
5. 管理后台 → 权限分级正常
6. 检查监控面板 → 无异常告警
7. 检查错误日志 → 无新增错误类型

## 灰度运营

### 第一批：内部账号（1-3 天）
- 开放 3-5 个团队内部账号
- FF_REAL_AI = true（仅内部）
- 每日检查：错误率、AI 成本、支付记录

### 第二批：种子用户（1 周）
- 开放 10-20 名学生用户
- 开启自动提醒
- 每日检查：打卡成功率、评分质量、用户反馈

### 第三批：扩大（持续）
- 逐步扩大到约 100 名用户
- 开启所有 Feature Flags
- 每周检查：增长趋势、付费转化、成本控制
