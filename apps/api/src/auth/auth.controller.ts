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

  @Post("wechat-mini/login")
  loginWechatMiniProgram(@Body() body: unknown) {
    return this.authService.loginWechatMiniProgram(body);
  }

  @Post("wechat-mini/bind-existing")
  bindWechatMiniProgramExisting(@Body() body: unknown) {
    return this.authService.bindWechatMiniProgramExisting(body);
  }

  @Post("wechat-mini/register")
  registerWechatMiniProgram(@Body() body: unknown) {
    return this.authService.registerWechatMiniProgram(body);
  }

  @Post("wechat-mini/refresh")
  refreshWechatMiniProgramSession(@Body() body: unknown) {
    return this.authService.refreshWechatMiniProgramSession(body);
  }

  @Post("wechat-mini/logout")
  logoutWechatMiniProgram(@Body() body: unknown) {
    return this.authService.logoutWechatMiniProgram(body);
  }

  @Delete("wechat-mini/binding")
  unbindWechatMiniProgram(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown
  ) {
    return this.authService.unbindWechatMiniProgram(authorization, body);
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
