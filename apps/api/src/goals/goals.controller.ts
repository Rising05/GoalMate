import {
  Body,
  Controller,
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

  @Get(":id/health")
  getHealth(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.goalsService.getGoalHealth(request.user!.id, id);
  }

  @Post(":id/generate-plan")
  generatePlan(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.aiJobsService.generateGoalPlan(request.user!.id, id);
  }

  @Post(":id/confirm-plan")
  confirmPlan(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.aiJobsService.confirmGoalPlan(request.user!.id, id);
  }
}
