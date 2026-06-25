/**
 * GoalMate API Performance Test Suite (k6)
 *
 * Usage:
 *   k6 run ops/perf/api-load-test.js \
 *     -e API_BASE_URL=http://localhost:3000 \
 *     -e TEST_EMAIL=perf_user0000@goalmate.test \
 *     -e TEST_PASSWORD=test123 \
 *     -e VUS=10 \
 *     -e DURATION=30s
 *
 * Prerequisites:
 *   1. Run the data generation script first: npx tsx apps/api/src/perf/generate-perf-data.ts
 *   2. Create at least one test user with a known password for auth testing
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend } from "k6/metrics";

// Custom metrics
const errorRate = new Rate("errors");
const loginDuration = new Trend("login_duration");
const tasksDuration = new Trend("tasks_duration");
const goalsDuration = new Trend("goals_duration");
const healthDuration = new Trend("health_duration");
const checkinDuration = new Trend("checkin_duration");
const timelineDuration = new Trend("timeline_duration");
const adminDuration = new Trend("admin_duration");

// Configuration
const BASE_URL = __ENV.API_BASE_URL || "http://localhost:3000";
const TEST_EMAIL = __ENV.TEST_EMAIL || "perf_user0000@goalmate.test";
const TEST_PASSWORD = __ENV.TEST_PASSWORD || "Password123!";

export const options = {
  stages: [
    { duration: "10s", target: 5 },   // Ramp up to 5 users
    { duration: "20s", target: 20 },  // Ramp up to 20 users
    { duration: "30s", target: 20 },  // Stay at 20 users
    { duration: "10s", target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ["p(95)<1000"], // 95% of requests under 1s
    http_req_failed: ["rate<0.05"],     // Less than 5% error rate
    errors: ["rate<0.05"],
  },
  noConnectionReuse: false,
};

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export default function () {
  let token = "";
  let goalId = "";

  // ---- Scenario 1: Login ----
  group("Login", () => {
    const loginStart = Date.now();
    const res = http.post(
      `${BASE_URL}/auth/login`,
      JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
      { headers: { "Content-Type": "application/json" } }
    );
    loginDuration.add(Date.now() - loginStart);

    const ok = check(res, {
      "login status 201": (r) => r.status === 201,
      "login has token": (r) => r.json("token") !== undefined,
    });
    errorRate.add(!ok);

    if (res.status === 201) {
      token = res.json("token");
    } else {
      console.warn(`Login failed: ${res.status} ${res.body}`);
    }
  });

  if (!token) {
    sleep(1);
    return;
  }

  // ---- Scenario 2: Fetch Goals ----
  group("Fetch Goals", () => {
    const start = Date.now();
    const res = http.get(`${BASE_URL}/goals`, { headers: authHeaders(token) });
    goalsDuration.add(Date.now() - start);

    const ok = check(res, {
      "goals status 200": (r) => r.status === 200,
      "goals is array": (r) => Array.isArray(r.json()),
    });
    errorRate.add(!ok);

    const goals = res.json();
    if (goals && goals.length > 0) {
      goalId = goals[0].id;
    }
  });

  // ---- Scenario 3: Fetch Today's Tasks ----
  group("Fetch Today Tasks", () => {
    const start = Date.now();
    const res = http.get(
      `${BASE_URL}/daily-tasks/today${goalId ? `?goalId=${goalId}` : ""}`,
      { headers: authHeaders(token) }
    );
    tasksDuration.add(Date.now() - start);

    const ok = check(res, {
      "tasks status 200": (r) => r.status === 200,
    });
    errorRate.add(!ok);
  });

  // ---- Scenario 4: Fetch Goal Health ----
  if (goalId) {
    group("Fetch Goal Health", () => {
      const start = Date.now();
      const res = http.get(`${BASE_URL}/goals/${goalId}/health`, {
        headers: authHeaders(token),
      });
      healthDuration.add(Date.now() - start);

      const ok = check(res, {
        "health status 200": (r) => r.status === 200,
        "health has score": (r) => r.json("healthScore") >= 0,
      });
      errorRate.add(!ok);
    });
  }

  // ---- Scenario 5: Fetch Growth Events (Timeline) ----
  group("Fetch Timeline", () => {
    const start = Date.now();
    const res = http.get(
      `${BASE_URL}/growth-events?limit=20`,
      { headers: authHeaders(token) }
    );
    timelineDuration.add(Date.now() - start);

    const ok = check(res, {
      "timeline status 200": (r) => r.status === 200,
    });
    errorRate.add(!ok);
  });

  // ---- Scenario 6: Fetch Heatmap Data ----
  group("Fetch Heatmap", () => {
    const start = Date.now();
    const res = http.get(
      `${BASE_URL}/daily-tasks/heatmap?days=180`,
      { headers: authHeaders(token) }
    );
    const ok = check(res, {
      "heatmap status 200": (r) => r.status === 200,
    });
    errorRate.add(!ok);
  });

  // ---- Scenario 7: Fetch Reward Board ----
  if (goalId) {
    group("Fetch Reward Board", () => {
      const start = Date.now();
      const res = http.get(`${BASE_URL}/rewards/${goalId}/board`, {
        headers: authHeaders(token),
      });
      const ok = check(res, {
        "reward board status 200": (r) => r.status === 200,
      });
      errorRate.add(!ok);
    });
  }

  // ---- Scenario 8: Fetch Notification Preferences ----
  group("Fetch Notifications", () => {
    const start = Date.now();
    const res = http.get(`${BASE_URL}/notifications/preferences`, {
      headers: authHeaders(token),
    });
    const ok = check(res, {
      "notifications status 200": (r) => r.status === 200,
    });
    errorRate.add(!ok);
  });

  sleep(1);
}

export function handleSummary(data) {
  const summary = {
    timestamp: new Date().toISOString(),
    test_duration_seconds: data.state.testRunDurationMs / 1000,
    total_requests: data.metrics.http_reqs?.values?.count || 0,
    total_failed: data.metrics.http_req_failed?.values?.fails || 0,
    http_req_duration_ms: {
      avg: data.metrics.http_req_duration?.values?.avg?.toFixed(2),
      p50: data.metrics.http_req_duration?.values?.["p(50)"]?.toFixed(2),
      p95: data.metrics.http_req_duration?.values?.["p(95)"]?.toFixed(2),
      p99: data.metrics.http_req_duration?.values?.["p(99)"]?.toFixed(2),
      min: data.metrics.http_req_duration?.values?.min?.toFixed(2),
      max: data.metrics.http_req_duration?.values?.max?.toFixed(2),
    },
    group_durations_ms: {
      login: data.metrics.login_duration?.values?.avg?.toFixed(2) || "N/A",
      tasks: data.metrics.tasks_duration?.values?.avg?.toFixed(2) || "N/A",
      goals: data.metrics.goals_duration?.values?.avg?.toFixed(2) || "N/A",
      health: data.metrics.health_duration?.values?.avg?.toFixed(2) || "N/A",
      checkin: data.metrics.checkin_duration?.values?.avg?.toFixed(2) || "N/A",
      timeline: data.metrics.timeline_duration?.values?.avg?.toFixed(2) || "N/A",
      admin: data.metrics.admin_duration?.values?.avg?.toFixed(2) || "N/A",
    },
    error_rate: data.metrics.errors?.values?.rate?.toFixed(4) || "0",
  };

  return {
    "stdout": JSON.stringify(summary, null, 2),
    "ops/perf/results/summary.json": JSON.stringify(summary, null, 2),
  };
}
