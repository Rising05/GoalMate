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
  listUsers(@Req() request: AuthenticatedRequest) {
    return this.adminService.listUsers(request.user!.id);
  }

  @Get("goals")
  listGoals(@Req() request: AuthenticatedRequest) {
    return this.adminService.listGoals(request.user!.id);
  }

  @Get("ai-jobs")
  listAiJobs(@Req() request: AuthenticatedRequest) {
    return this.adminService.listAiJobs(request.user!.id);
  }

  @Get("email-logs")
  listEmailLogs(@Req() request: AuthenticatedRequest) {
    return this.adminService.listEmailLogs(request.user!.id);
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
}
