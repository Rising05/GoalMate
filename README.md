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
3. Goal settlement, failure reports, restart flow, reward board, notification preferences/email logs, membership quota checks, and admin audit interfaces.
4. Health report rescue metrics and daily `health_snapshots` for future trend charts.

Core validation commands:

```bash
npm run typecheck
npm run test:integration
npm run build
```
