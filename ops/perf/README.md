# GoalMate 性能基线测试

## 快速开始

### 1. 生成测试数据

```bash
# 生成 100 个用户的基础测试数据
PERF_USERS=100 PERF_GOALS_PER_USER=3 PERF_TASK_DAYS=30 \
npx tsx apps/api/src/perf/generate-perf-data.ts

# 清理旧数据后重新生成
PERF_CLEAN_FIRST=true PERF_USERS=20 \
npx tsx apps/api/src/perf/generate-perf-data.ts
```

### 2. API 负载测试

```bash
# 安装 k6 (macOS)
brew install k6

# 运行综合负载测试
k6 run ops/perf/api-load-test.js \
  -e API_BASE_URL=http://localhost:3000 \
  -e TEST_EMAIL=perf_user0000@goalmate.test \
  -e TEST_PASSWORD=Password123!

# 运行并发打卡压力测试
k6 run ops/perf/concurrency-test.js \
  -e API_BASE_URL=http://localhost:3000 \
  -e TEST_EMAIL=perf_user0000@goalmate.test \
  -e TEST_PASSWORD=Password123!
```

### 3. 验收标准

| 指标 | 目标 | 备注 |
| --- | --- | --- |
| 常规读取 P95 | < 1 秒 | goals, tasks, health |
| AI 操作完成时间 | < 1 分钟 | queued → success/fail |
| 100 并发下稳定性 | 无连接池耗尽 | MySQL + Redis |
| 数据库无 N+1 | 慢查询日志验证 | |

### 4. 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PERF_USERS` | 100 | 生成用户数 |
| `PERF_GOALS_PER_USER` | 3 | 每用户目标数 |
| `PERF_TASK_DAYS` | 30 | 历史任务天数 |
| `PERF_TASKS_PER_DAY` | 3 | 每天任务数 |
| `PERF_CHECKIN_RATE` | 0.8 | 已完成任务打卡比例 |
| `PERF_AI_JOBS_PER_GOAL` | 5 | 每目标模拟 AI Job |
| `PERF_EMAIL_LOGS_PER_USER` | 10 | 每用户邮件日志 |
| `PERF_CLEAN_FIRST` | false | 是否先清理旧数据 |
| `PERF_PREFIX` | perf_ | 数据标识前缀 |

## 实际测试记录

待首次执行后填入。
