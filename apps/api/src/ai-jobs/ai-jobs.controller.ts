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

  @Post(":id/cancel")
  cancelJob(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: unknown
  ) {
    return this.aiJobsService.cancelJob(request.user!.id, id, body);
  }
}
