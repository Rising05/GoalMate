import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { PasswordService } from "./password.service";
import { SessionTokenService } from "./session-token.service";

@Module({
  controllers: [AuthController],
  providers: [AuthService, PasswordService, SessionTokenService],
  exports: [AuthService, SessionTokenService]
})
export class AuthModule {}

