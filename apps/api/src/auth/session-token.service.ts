import { Injectable, UnauthorizedException } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";

interface SessionPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
  sid?: string;
  clientType?: string;
  deviceId?: string;
}

interface SignInput {
  sub: string;
  email: string;
  sessionId?: string;
  clientType?: string;
  deviceId?: string;
  ttlSeconds?: number;
}

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

@Injectable()
export class SessionTokenService {
  sign(input: SignInput) {
    const now = Math.floor(Date.now() / 1000);
    const payload: SessionPayload = {
      sub: input.sub,
      email: input.email,
      iat: now,
      exp: now + (input.ttlSeconds ?? SESSION_TTL_SECONDS),
      ...(input.sessionId ? { sid: input.sessionId } : {}),
      ...(input.clientType ? { clientType: input.clientType } : {}),
      ...(input.deviceId ? { deviceId: input.deviceId } : {})
    };

    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
      "base64url"
    );
    const signature = this.signPayload(encodedPayload);

    return `${encodedPayload}.${signature}`;
  }

  verify(token: string): SessionPayload {
    const [encodedPayload, signature] = token.split(".");

    if (!encodedPayload || !signature) {
      throw new UnauthorizedException("登录状态无效");
    }

    const expectedSignature = this.signPayload(encodedPayload);
    const actual = Buffer.from(signature, "base64url");
    const expected = Buffer.from(expectedSignature, "base64url");

    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new UnauthorizedException("登录状态无效");
    }

    const payload = this.parsePayload(encodedPayload);

    if (payload.exp <= Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException("登录状态已过期");
    }

    return payload;
  }

  private signPayload(payload: string) {
    return createHmac("sha256", this.secret()).update(payload).digest("base64url");
  }

  private secret() {
    return (
      process.env.SESSION_SECRET ??
      "dev-only-session-secret-change-before-production"
    );
  }

  private parsePayload(encodedPayload: string): SessionPayload {
    try {
      const parsed = JSON.parse(
        Buffer.from(encodedPayload, "base64url").toString("utf8")
      ) as Partial<SessionPayload>;

      if (
        typeof parsed.sub !== "string" ||
        typeof parsed.email !== "string" ||
        typeof parsed.iat !== "number" ||
        typeof parsed.exp !== "number" ||
        (parsed.sid !== undefined && typeof parsed.sid !== "string") ||
        (parsed.clientType !== undefined && typeof parsed.clientType !== "string") ||
        (parsed.deviceId !== undefined && typeof parsed.deviceId !== "string")
      ) {
        throw new Error("Invalid payload");
      }

      return parsed as SessionPayload;
    } catch {
      throw new UnauthorizedException("登录状态无效");
    }
  }
}
