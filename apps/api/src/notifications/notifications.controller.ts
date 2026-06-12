import {
  Body,
  Delete,
  Controller,
  Get,
  Inject,
  Post,
  Put,
  Req,
  UseGuards
} from "@nestjs/common";
import { AuthenticatedRequest, AuthGuard } from "../auth/auth.guard";
import { NotificationsService } from "./notifications.service";

@Controller("notifications")
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(
    @Inject(NotificationsService)
    private readonly notificationsService: NotificationsService
  ) {}

  @Get("preferences")
  getPreference(@Req() request: AuthenticatedRequest) {
    return this.notificationsService.getPreference(request.user!.id);
  }

  @Put("preferences")
  updatePreference(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown
  ) {
    return this.notificationsService.updatePreference(request.user!.id, body);
  }

  @Get("email-logs")
  listEmailLogs(@Req() request: AuthenticatedRequest) {
    return this.notificationsService.listEmailLogs(request.user!.id);
  }

  @Get("wechat-binding")
  getWechatBinding(@Req() request: AuthenticatedRequest) {
    return this.notificationsService.getWechatBinding(request.user!.id);
  }

  @Put("wechat-binding")
  bindWechat(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown
  ) {
    return this.notificationsService.bindWechat(request.user!.id, body);
  }

  @Delete("wechat-binding")
  unbindWechat(@Req() request: AuthenticatedRequest) {
    return this.notificationsService.unbindWechat(request.user!.id);
  }

  @Post("email-logs/preview")
  createPreviewEmailLog(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown
  ) {
    return this.notificationsService.createPreviewEmailLog(request.user!.id, body);
  }

  @Post("email-logs/enqueue-due")
  enqueueDueEmailLogs(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown
  ) {
    return this.notificationsService.enqueueDueEmailLogs(request.user!.id, body);
  }

  @Post("email-logs/process-queue")
  processQueuedEmailLogs(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown
  ) {
    return this.notificationsService.processQueuedEmailLogs(request.user!.id, body);
  }

  @Post("email-logs/retry-failed")
  retryFailedEmailLogs(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown
  ) {
    return this.notificationsService.retryFailedEmailLogs(request.user!.id, body);
  }
}
