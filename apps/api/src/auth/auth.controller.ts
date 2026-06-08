import { Body, Controller, Get, Headers, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
}

