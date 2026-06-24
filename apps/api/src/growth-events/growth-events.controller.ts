import { Controller, Get, Inject, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthenticatedRequest, AuthGuard } from "../auth/auth.guard";
import { GrowthEventsService } from "./growth-events.service";

@Controller("growth-events")
@UseGuards(AuthGuard)
export class GrowthEventsController {
  constructor(
    @Inject(GrowthEventsService)
    private readonly growthEventsService: GrowthEventsService
  ) {}

  @Get()
  list(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    return this.growthEventsService.list(request.user!.id, query);
  }

  @Post("backfill")
  backfill(@Req() request: AuthenticatedRequest) {
    return this.growthEventsService.backfillForUser(request.user!.id);
  }
}
