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

The first implementation milestone focuses on the end-to-end MVP skeleton:

1. Web goal creation guide.
2. API health check.
3. Shared domain vocabulary.
4. Future-ready modules for auth, goals, AI jobs, reminders, and admin.

