import {
  BadRequestException,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { PasswordService } from "./password.service";
import { SessionTokenService } from "./session-token.service";

interface AuthPayload {
  email: string;
  password: string;
  displayName?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly sessionTokenService: SessionTokenService
  ) {}

  async register(input: unknown) {
    const payload = this.parseAuthPayload(input, true);
    const existing = await this.prisma.user.findUnique({
      where: { email: payload.email }
    });

    if (existing) {
      throw new BadRequestException("该邮箱已注册");
    }

    const passwordHash = this.passwordService.hash(payload.password);
    const user = await this.prisma.user.create({
      data: {
        email: payload.email,
        passwordHash,
        displayName: payload.displayName,
        membership: {
          create: {
            plan: "FREE",
            status: "ACTIVE"
          }
        }
      },
      include: {
        membership: true
      }
    });

    return this.buildAuthResponse(user);
  }

  async login(input: unknown) {
    const payload = this.parseAuthPayload(input, false);
    const user = await this.prisma.user.findUnique({
      where: { email: payload.email },
      include: { membership: true }
    });

    if (!user || user.status !== "ACTIVE") {
      throw new UnauthorizedException("邮箱或密码不正确");
    }

    const passwordMatches = this.passwordService.verify(
      payload.password,
      user.passwordHash
    );

    if (!passwordMatches) {
      throw new UnauthorizedException("邮箱或密码不正确");
    }

    return this.buildAuthResponse(user);
  }

  async getCurrentUser(authorization?: string) {
    const token = this.extractBearerToken(authorization);
    const session = this.sessionTokenService.verify(token);
    const user = await this.prisma.user.findUnique({
      where: { id: session.sub },
      include: { membership: true }
    });

    if (!user || user.status !== "ACTIVE") {
      throw new UnauthorizedException("登录状态已失效");
    }

    return {
      user: this.sanitizeUser(user)
    };
  }

  private buildAuthResponse(user: {
    id: string;
    email: string;
    displayName: string | null;
    status: string;
    createdAt: Date;
    membership: {
      plan: string;
      status: string;
      expiresAt: Date | null;
    } | null;
  }) {
    const token = this.sessionTokenService.sign({
      sub: user.id,
      email: user.email
    });

    return {
      token,
      user: this.sanitizeUser(user)
    };
  }

  private sanitizeUser(user: {
    id: string;
    email: string;
    displayName: string | null;
    status: string;
    createdAt: Date;
    membership: {
      plan: string;
      status: string;
      expiresAt: Date | null;
    } | null;
  }) {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      status: user.status,
      createdAt: user.createdAt.toISOString(),
      membership: user.membership
        ? {
            plan: user.membership.plan,
            status: user.membership.status,
            expiresAt: user.membership.expiresAt?.toISOString() ?? null
          }
        : null
    };
  }

  private parseAuthPayload(input: unknown, allowDisplayName: boolean): AuthPayload {
    if (!input || typeof input !== "object") {
      throw new BadRequestException("请求参数不正确");
    }

    const body = input as Record<string, unknown>;
    const email = this.normalizeEmail(body.email);
    const password = typeof body.password === "string" ? body.password : "";
    const displayName =
      allowDisplayName && typeof body.displayName === "string"
        ? body.displayName.trim().slice(0, 40)
        : undefined;

    if (!email) {
      throw new BadRequestException("请输入有效邮箱");
    }

    if (password.length < 8) {
      throw new BadRequestException("密码至少需要 8 位");
    }

    return {
      email,
      password,
      displayName: displayName || undefined
    };
  }

  private normalizeEmail(value: unknown) {
    if (typeof value !== "string") {
      return "";
    }

    const email = value.trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
  }

  private extractBearerToken(authorization?: string) {
    const [scheme, token] = authorization?.split(" ") ?? [];

    if (scheme !== "Bearer" || !token) {
      throw new UnauthorizedException("请先登录");
    }

    return token;
  }
}

