import { Controller, Get, Param, Post, Req, UseGuards, Body } from "@nestjs/common";
import { AuthenticatedRequest, AuthGuard } from "../auth/auth.guard";
import { GoalsService } from "./goals.service";

@Controller("goals")
@UseGuards(AuthGuard)
export class GoalsController {
  constructor(private readonly goalsService: GoalsService) {}

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
}

