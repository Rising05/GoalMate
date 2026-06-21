import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import { AuthenticatedRequest, AuthGuard } from "../auth/auth.guard";
import { AdminService } from "./admin.service";

@Controller("admin")
@UseGuards(AuthGuard)
export class AdminController {
  constructor(
    @Inject(AdminService)
    private readonly adminService: AdminService
  ) {}

  @Get("overview")
  getOverview(@Req() request: AuthenticatedRequest) {
    return this.adminService.getOverview(request.user!.id);
  }

  @Get("users")
  listUsers(
    @Req() request: AuthenticatedRequest,
    @Query() query: Record<string, unknown>
  ) {
    return this.adminService.listUsers(request.user!.id, query);
  }

  @Get("goals")
  listGoals(
    @Req() request: AuthenticatedRequest,
    @Query() query: Record<string, unknown>
  ) {
    return this.adminService.listGoals(request.user!.id, query);
  }

  @Get("ai-jobs")
  listAiJobs(
    @Req() request: AuthenticatedRequest,
    @Query() query: Record<string, unknown>
  ) {
    return this.adminService.listAiJobs(request.user!.id, query);
  }

  @Get("ai-call-logs")
  listAiCallLogs(
    @Req() request: AuthenticatedRequest,
    @Query() query: Record<string, unknown>
  ) {
    return this.adminService.listAiCallLogs(request.user!.id, query);
  }

  @Post("ai-jobs/:jobId/retry")
  retryAiJob(
    @Req() request: AuthenticatedRequest,
    @Param("jobId") jobId: string,
    @Body() body: unknown
  ) {
    return this.adminService.retryAiJob(request.user!.id, jobId, body);
  }

  @Get("email-logs")
  listEmailLogs(
    @Req() request: AuthenticatedRequest,
    @Query() query: Record<string, unknown>
  ) {
    return this.adminService.listEmailLogs(request.user!.id, query);
  }

  @Post("email-logs/:logId/retry")
  retryEmailLog(@Req() request: AuthenticatedRequest, @Param("logId") logId: string, @Body() body: unknown) {
    return this.adminService.retryEmailLog(request.user!.id, logId, body);
  }

  @Get("upload-assets")
  listUploadAssets(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return this.adminService.listUploadAssets(request.user!.id, query);
  }

  @Get("payment-events")
  listPaymentEvents(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return this.adminService.listPaymentEvents(request.user!.id, query);
  }

  @Get("membership-audits")
  listMembershipAudits(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return this.adminService.listMembershipAudits(request.user!.id, query);
  }

  @Patch("users/:userId/membership")
  updateMembership(
    @Req() request: AuthenticatedRequest,
    @Param("userId") userId: string,
    @Body() body: unknown
  ) {
    return this.adminService.updateMembership(request.user!.id, userId, body);
  }

  @Get("users/:userId/raw-content")
  getRawUserContent(
    @Req() request: AuthenticatedRequest,
    @Param("userId") userId: string,
    @Query("reason") reason?: string
  ) {
    return this.adminService.getRawUserContent(request.user!.id, userId, reason);
  }

  @Get("audit-logs")
  listAuditLogs(@Req() request: AuthenticatedRequest) {
    return this.adminService.listAuditLogs(request.user!.id);
  }

  @Get("system-configs")
  listSystemConfigs(@Req() request: AuthenticatedRequest) {
    return this.adminService.listSystemConfigs(request.user!.id);
  }

  @Post("system-configs")
  upsertSystemConfig(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown
  ) {
    return this.adminService.upsertSystemConfig(request.user!.id, body);
  }

  @Post("notifications/scheduler/run")
  runNotificationScheduler(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown
  ) {
    return this.adminService.runNotificationScheduler(request.user!.id, body);
  }

  @Post("queues/reconcile")
  reconcileQueues(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown
  ) {
    return this.adminService.reconcileQueues(request.user!.id, body);
  }
}
