import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
import { PasswordService } from "./password.service";
import { SessionTokenService } from "./session-token.service";

@Module({
  controllers: [AuthController],
  providers: [AuthGuard, AuthService, PasswordService, SessionTokenService],
  exports: [AuthGuard, AuthService, SessionTokenService]
})
export class AuthModule {}
