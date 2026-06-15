import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import { AiJobsService } from "../ai-jobs/ai-jobs.service";
import { AuthenticatedRequest, AuthGuard } from "../auth/auth.guard";
import { GoalsService } from "./goals.service";

@Controller("goals")
@UseGuards(AuthGuard)
export class GoalsController {
  constructor(
    @Inject(GoalsService)
    private readonly goalsService: GoalsService,
    @Inject(AiJobsService)
    private readonly aiJobsService: AiJobsService
  ) {}

  @Post()
  create(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.goalsService.createGoal(request.user!.id, body);
  }

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.goalsService.listGoals(request.user!.id);
  }

  @Get(":id")
  getById(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.goalsService.getGoalById(request.user!.id, id);
  }

  @Delete(":id")
  deleteGoal(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.goalsService.deleteGoal(request.user!.id, id);
  }

  @Get(":id/health")
  getHealth(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.goalsService.getGoalHealth(request.user!.id, id);
  }

  @Get(":id/health-snapshots")
  getHealthSnapshots(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string
  ) {
    return this.goalsService.listHealthSnapshots(request.user!.id, id);
  }

  @Post(":id/health-snapshots/enqueue")
  enqueueHealthSnapshotReport(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: unknown
  ) {
    return this.goalsService.enqueueHealthSnapshotReport(
      request.user!.id,
      id,
      body
    );
  }

  @Post(":id/reports/enqueue")
  enqueueReport(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: unknown
  ) {
    return this.goalsService.enqueueGoalReport(request.user!.id, id, body);
  }

  @Post(":id/health-trends")
  getHealthTrendReport(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: unknown
  ) {
    return this.goalsService.getHealthTrendReport(request.user!.id, id, body);
  }

  @Post(":id/settle")
  settle(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.goalsService.settleGoal(request.user!.id, id);
  }

  @Get(":id/failure-report")
  getFailureReport(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string
  ) {
    return this.goalsService.getFailureReport(request.user!.id, id);
  }

  @Post(":id/restart")
  restart(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: unknown
  ) {
    return this.goalsService.restartGoal(request.user!.id, id, body);
  }

  @Post(":id/rescue-task")
  generateRescueTask(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string
  ) {
    return this.goalsService.generateRescueTask(request.user!.id, id);
  }

  @Get(":id/plan")
  getPlan(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.aiJobsService.getGoalPlan(request.user!.id, id);
  }

  @Post(":id/generate-plan")
  generatePlan(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.aiJobsService.generateGoalPlan(request.user!.id, id);
  }

  @Post(":id/request-replan")
  requestReplan(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: unknown
  ) {
    return this.aiJobsService.requestGoalReplan(request.user!.id, id, body);
  }

  @Post(":id/confirm-plan")
  confirmPlan(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.aiJobsService.confirmGoalPlan(request.user!.id, id);
  }
}
