import { FormEvent, useState } from "react";
import { LogIn, UserPlus } from "lucide-react";
import { AuthResponse, authenticate } from "./api";

interface AuthPanelProps {
  onAuthenticated: (response: AuthResponse) => void;
}

export function AuthPanel({ onAuthenticated }: AuthPanelProps) {
  const [mode, setMode] = useState<"login" | "register">("register");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("注册后会自动开通免费版额度。");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage("正在连接 GoalPilot AI...");

    try {
      const response = await authenticate(mode, {
        email,
        password,
        displayName: mode === "register" ? displayName : undefined
      });

      localStorage.setItem("goalmate.session", response.token);
      onAuthenticated(response);
      setMessage(`已登录：${response.user.email}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "认证请求失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="auth-panel" aria-label="账号入口">
      <div className="auth-tabs" role="tablist" aria-label="账号操作">
        <button
          className={mode === "register" ? "active" : ""}
          type="button"
          onClick={() => {
            setMode("register");
            setMessage("注册后会自动开通免费版额度。");
          }}
        >
          <UserPlus size={16} aria-hidden="true" />
          注册
        </button>
        <button
          className={mode === "login" ? "active" : ""}
          type="button"
          onClick={() => {
            setMode("login");
            setMessage("登录后继续创建或查看目标。");
          }}
        >
          <LogIn size={16} aria-hidden="true" />
          登录
        </button>
      </div>

      <form className="auth-form" onSubmit={handleSubmit}>
        {mode === "register" ? (
          <label>
            <span>昵称</span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="例如：Rising"
            />
          </label>
        ) : null}

        <label>
          <span>邮箱</span>
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            type="email"
            autoComplete="email"
            required
          />
        </label>

        <label>
          <span>密码</span>
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="至少 8 位"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={8}
            required
          />
        </label>

        <button className="primary-button full-width" disabled={isSubmitting}>
          {isSubmitting ? "处理中..." : mode === "register" ? "创建账号" : "登录"}
        </button>
      </form>

      <p className="auth-message">{message}</p>
    </section>
  );
}

