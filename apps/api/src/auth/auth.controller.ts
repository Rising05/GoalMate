import { Body, Controller, Delete, Get, Headers, Inject, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post("register")
  register(@Body() body: unknown) {
    return this.authService.register(body);
  }

  @Post("login")
  login(@Body() body: unknown) {
    return this.authService.login(body);
  }

  @Get("me")
  me(@Headers("authorization") authorization?: string) {
    return this.authService.getCurrentUser(authorization);
  }

  @Post("export")
  exportData(@Headers("authorization") authorization: string | undefined, @Body() body: unknown) {
    return this.authService.exportCurrentUserData(authorization, body);
  }

  @Delete("me")
  deleteMe(@Headers("authorization") authorization?: string) {
    return this.authService.deleteCurrentUser(authorization);
  }
}
