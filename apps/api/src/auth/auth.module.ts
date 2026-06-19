import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
import { PasswordService } from "./password.service";
import { SessionTokenService } from "./session-token.service";
import {
  LocalStorageProvider,
  STORAGE_PROVIDER
} from "../uploads/storage-provider";
import { QuotaModule } from "../quota/quota.module";

@Module({
  imports: [QuotaModule],
  controllers: [AuthController],
  providers: [
    AuthGuard,
    AuthService,
    PasswordService,
    SessionTokenService,
    LocalStorageProvider,
    { provide: STORAGE_PROVIDER, useExisting: LocalStorageProvider }
  ],
  exports: [AuthGuard, AuthService, SessionTokenService]
})
export class AuthModule {}
