import { Controller, Get, Inject, Param, Req, UseGuards } from "@nestjs/common";
import { AuthenticatedRequest, AuthGuard } from "../auth/auth.guard";
import { AiJobsService } from "./ai-jobs.service";

@Controller("ai-jobs")
@UseGuards(AuthGuard)
export class AiJobsController {
  constructor(
    @Inject(AiJobsService)
    private readonly aiJobsService: AiJobsService
  ) {}

  @Get(":id")
  getJob(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.aiJobsService.getJob(request.user!.id, id);
  }
}
