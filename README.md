# GoalMate

GoalMate is the implementation repo for GoalPilot AI, an AI-powered goal companion and growth visualization platform.

See [SPEC.md](./SPEC.md) for the product and architecture specification.

## Workspace

- `apps/web`: React + TypeScript + Vite web app.
- `apps/api`: NestJS + TypeScript API service.
- `packages/shared`: Shared domain types and constants.

## Local Development

```bash
npm install
npm run dev:web
npm run dev:api
```

## Current Milestone

The MVP now covers the core GoalPilot AI loop:

1. Email registration/login, goal creation, mock AI plan generation, and plan confirmation.
2. Daily tasks, text check-ins, mock AI scoring, score appeals, deviation detection, rescue tasks, heatmap, health report, and growth timeline.
3. Goal settlement, failure reports, restart flow, reward board, notification preferences/email logs, membership quota checks, AI usage statistics, and admin audit interfaces.
4. Health report rescue metrics and daily `health_snapshots` for future trend charts.
5. AI provider abstraction with Mock default, optional DeepSeek provider, AI job status lookup/cancellation with web polling, scoring/mail provider abstractions, BullMQ/Redis queue metadata, and opt-in AI/email/report workers for plan, check-in scoring, reminder, health snapshot, and trend summary jobs.
6. Privacy deletion endpoints, current-user data export, and upload evidence metadata endpoints for Web/WeChat check-in evidence.
7. Liquid Glass web foundation with internal Glass components, semantic status/metric tokens, reduced-motion/fallback styling, and upgraded goal cockpit, plan review, today tasks, AI job status, timeline, rewards, account, and admin summary surfaces.
8. Playwright E2E coverage for the new-user MVP loop from registration through plan confirmation, check-in, rescue task, heatmap, timeline, and API data assertions.

Useful optional environment variables for the API:

- `AI_PROVIDER=deepseek`
- `DEEPSEEK_API_KEY=...`
- `DEEPSEEK_MODEL=deepseek-chat`
- `BULLMQ_ENABLED=true`
- `CHECKIN_SCORING_ASYNC=true`
- `BULLMQ_WORKERS_ENABLED=true`
- `REDIS_URL=redis://127.0.0.1:6379`

Core validation commands:

```bash
npm run typecheck
npm run test:integration
npm run test:e2e
npm run build
```
