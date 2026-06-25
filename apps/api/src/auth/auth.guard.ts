import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SessionTokenService } from "./session-token.service";

export interface AuthenticatedUser {
  id: string;
  email: string;
}

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthenticatedUser;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(SessionTokenService)
    private readonly sessionTokenService: SessionTokenService
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const token = this.extractBearerToken(
      Array.isArray(authorization) ? authorization[0] : authorization
    );
    const session = this.sessionTokenService.verify(token);
    const user = await this.prisma.user.findUnique({
      where: { id: session.sub },
      select: {
        id: true,
        email: true,
        status: true
      }
    });

    if (!user || user.status !== "ACTIVE") {
      throw new UnauthorizedException("登录状态已失效");
    }

    if (session.sid) {
      const clientSession = await this.prisma.clientSession.findFirst({
        where: {
          id: session.sid,
          userId: user.id,
          status: "ACTIVE",
          expiresAt: { gt: new Date() },
          revokedAt: null
        },
        select: { id: true }
      });

      if (!clientSession) {
        throw new UnauthorizedException("登录状态已失效");
      }
    }

    request.user = {
      id: user.id,
      email: user.email
    };

    return true;
  }

  private extractBearerToken(authorization?: string) {
    const [scheme, token] = authorization?.split(" ") ?? [];

    if (scheme !== "Bearer" || !token) {
      throw new UnauthorizedException("请先登录");
    }

    return token;
  }
}
