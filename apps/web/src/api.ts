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

  const data = (await response.json().catch(() => null)) as
    | AuthResponse
    | { message?: string }
    | null;

  if (!response.ok) {
    const message =
      data && "message" in data && typeof data.message === "string"
        ? data.message
        : "认证请求失败";

    throw new Error(message);
  }

  return data as AuthResponse;
}
