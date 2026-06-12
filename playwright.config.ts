import { defineConfig, devices } from "@playwright/test";

const apiPort = process.env.E2E_API_PORT ?? "3100";
const webPort = process.env.E2E_WEB_PORT ?? "5174";
const apiUrl = `http://127.0.0.1:${apiPort}`;
const webUrl = `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120_000,
  expect: {
    timeout: 15_000
  },
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: webUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"]
      }
    }
  ],
  webServer: [
    {
      command: `API_PORT=${apiPort} API_HOST=127.0.0.1 WEB_ORIGIN=${webUrl} BULLMQ_ENABLED=false npm run start:e2e -w @goalmate/api`,
      url: `${apiUrl}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000
    },
    {
      command: `VITE_API_BASE_URL=${apiUrl} npm run dev -w @goalmate/web -- --host 127.0.0.1 --port ${webPort}`,
      url: webUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000
    }
  ]
});
