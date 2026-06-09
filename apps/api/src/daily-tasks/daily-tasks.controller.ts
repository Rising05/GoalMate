import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import { AuthenticatedRequest, AuthGuard } from "../auth/auth.guard";
import { DailyTasksService } from "./daily-tasks.service";

@Controller("daily-tasks")
@UseGuards(AuthGuard)
export class DailyTasksController {
  constructor(
    @Inject(DailyTasksService)
    private readonly dailyTasksService: DailyTasksService
  ) {}

  @Get("today")
  getToday(
    @Req() request: AuthenticatedRequest,
    @Query("goalId") goalId?: string
  ) {
    return this.dailyTasksService.getTodayTasks(request.user!.id, goalId);
  }

  @Get("activity")
  getActivity(
    @Req() request: AuthenticatedRequest,
    @Query("year") year?: string,
    @Query("goalId") goalId?: string
  ) {
    return this.dailyTasksService.getYearActivity(request.user!.id, year, goalId);
  }

  @Post(":id/complete")
  complete(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: unknown
  ) {
    return this.dailyTasksService.completeTask(request.user!.id, id, body);
  }
}
