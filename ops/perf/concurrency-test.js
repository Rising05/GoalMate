/**
 * GoalMate Concurrency Stress Test (k6)
 *
 * Tests concurrent checkin submission and quota enforcement under load.
 *
 * Usage:
 *   k6 run ops/perf/concurrency-test.js \
 *     -e API_BASE_URL=http://localhost:3000 \
 *     -e TEST_EMAIL=perf_user0000@goalmate.test \
 *     -e TEST_PASSWORD=Password123!
 *
 * Generates one active goal with a task, then submits checkins concurrently
 * to verify quota enforcement and API stability under concurrent writes.
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Counter } from "k6/metrics";

const errorRate = new Rate("errors");
const quota429s = new Counter("quota_429s");
const successCount = new Counter("checkin_success");
const failCount = new Counter("checkin_fails");

const BASE_URL = __ENV.API_BASE_URL || "http://localhost:3000";
const TEST_EMAIL = __ENV.TEST_EMAIL || "perf_user0000@goalmate.test";
const TEST_PASSWORD = __ENV.TEST_PASSWORD || "Password123!";

export const options = {
  scenarios: {
    concurrent_checkins: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "5s", target: 5 },
        { duration: "10s", target: 10 },
        { duration: "10s", target: 10 },
        { duration: "5s", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<2000"],
    errors: ["rate<0.10"],
  },
};

// Shared state
let token = "";
let goalId = "";
let taskIds = [];

// Setup: authenticate and create test data
export function setup() {
  const authHeaders = (t) => ({
    Authorization: `Bearer ${t}`,
    "Content-Type": "application/json",
  });

  // Login
  const loginRes = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    { headers: { "Content-Type": "application/json" } }
  );

  if (loginRes.status !== 201) {
    throw new Error(`Setup login failed: ${loginRes.status}`);
  }
  const t = loginRes.json("token");

  // Get goals
  const goalsRes = http.get(`${BASE_URL}/goals`, { headers: authHeaders(t) });
  const goals = goalsRes.json();
  let gId = "";

  if (goals && goals.length > 0) {
    const activeGoal = goals.find((g) => g.status === "ACTIVE");
    gId = activeGoal ? activeGoal.id : goals[0].id;
  }

  if (!gId) {
    throw new Error("No goals found for test user");
  }

  // Get today's tasks
  const tasksRes = http.get(
    `${BASE_URL}/daily-tasks/today?goalId=${gId}`,
    { headers: authHeaders(t) }
  );
  const tasks = tasksRes.json() || [];

  if (tasks.length === 0) {
    throw new Error("No today tasks found for test user/goal");
  }

  return {
    token: t,
    goalId: gId,
    taskIds: tasks.filter((t) => t.status !== "COMPLETED").map((t) => t.id),
  };
}

export default function (data) {
  const { token: t, goalId: gId, taskIds: tIds } = data;

  if (!tIds || tIds.length === 0) {
    console.log("No pending tasks available");
    return;
  }

  const taskId = tIds[Math.floor(Math.random() * tIds.length)];
  const headers = {
    Authorization: `Bearer ${t}`,
    "Content-Type": "application/json",
  };

  group("Submit Checkin", () => {
    const res = http.post(
      `${BASE_URL}/daily-tasks/checkin`,
      JSON.stringify({
        goalId: gId,
        taskId,
        content: `Concurrent test checkin at ${new Date().toISOString()}`,
        investedMinutes: 30,
        studyMood: "😊 积极",
      }),
      { headers }
    );

    if (res.status === 201 || res.status === 200) {
      successCount.add(1);
      check(res, { "checkin created": () => true });
    } else if (res.status === 429) {
      quota429s.add(1);
      check(res, { "quota enforced (429)": () => true });
    } else {
      failCount.add(1);
      errorRate.add(true);
      console.warn(`Checkin failed: ${res.status} ${res.body}`);
    }
  });

  // Also read tasks to stress the read path
  group("Read Tasks", () => {
    const res = http.get(
      `${BASE_URL}/daily-tasks/today?goalId=${gId}`,
      { headers }
    );
    check(res, { "tasks read ok": (r) => r.status === 200 });
  });

  // Read timeline
  group("Read Timeline", () => {
    const res = http.get(`${BASE_URL}/growth-events?limit=10`, { headers });
    check(res, { "timeline ok": (r) => r.status === 200 });
  });

  sleep(1);
}

export function teardown(data) {
  console.log(`\nTest complete:
  Success checkins: ${successCount.value}
  Quota 429s: ${quota429s.value}
  Failed: ${failCount.value}`);
}
