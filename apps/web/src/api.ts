const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:3000";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  status: string;
  createdAt: string;
  membership: {
    plan: string;
    status: string;
    expiresAt: string | null;
  } | null;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface Goal {
  id: string;
  title: string;
  description: string;
  category: string;
  status: string;
  startDate: string;
  endDate: string;
  toleranceDaysAllowed: number;
  toleranceDaysUsed: number;
  dailyTimeBudgetMinutes: number | null;
  currentBaseline: string | null;
  constraints: string | null;
  finalReward: string | null;
}

export interface CreateGoalInput {
  title?: string;
  description: string;
  category: string;
  startDate: string;
  endDate: string;
  dailyTimeBudgetMinutes?: number;
  toleranceDaysAllowed?: number;
  currentBaseline?: string;
  constraints?: string;
  finalReward?: string;
}

export async function authenticate(
  mode: "login" | "register",
  payload: {
    email: string;
    password: string;
    displayName?: string;
  }
) {
  const response = await fetch(`${API_BASE_URL}/auth/${mode}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await parseJson<AuthResponse>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "认证请求失败"));
  }

  return data as AuthResponse;
}

export async function createGoal(token: string, payload: CreateGoalInput) {
  const response = await fetch(`${API_BASE_URL}/goals`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await parseJson<{ goal: Goal }>(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(data, "目标创建失败"));
  }

  return data as { goal: Goal };
}

async function parseJson<T>(response: Response) {
  return (await response.json().catch(() => null)) as
    | T
    | { message?: string | string[] }
    | null;
}

function getErrorMessage(
  data: unknown,
  fallback: string
) {
  if (!data || typeof data !== "object" || !("message" in data)) {
    return fallback;
  }

  const message = (data as { message?: unknown }).message;

  if (typeof message === "string") {
    return message;
  }

  if (Array.isArray(message)) {
    return message.filter((item) => typeof item === "string").join("；");
  }

  return fallback;
}
