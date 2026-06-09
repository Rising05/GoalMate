import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import { AuthenticatedRequest, AuthGuard } from "../auth/auth.guard";
import { RewardsService } from "./rewards.service";

@Controller("goals/:goalId/rewards")
@UseGuards(AuthGuard)
export class RewardsController {
  constructor(
    @Inject(RewardsService)
    private readonly rewardsService: RewardsService
  ) {}

  @Get()
  getBoard(
    @Req() request: AuthenticatedRequest,
    @Param("goalId") goalId: string
  ) {
    return this.rewardsService.getRewardBoard(request.user!.id, goalId);
  }

  @Post()
  createCard(
    @Req() request: AuthenticatedRequest,
    @Param("goalId") goalId: string,
    @Body() body: unknown
  ) {
    return this.rewardsService.createRewardCard(request.user!.id, goalId, body);
  }

  @Patch(":cardId")
  updateCard(
    @Req() request: AuthenticatedRequest,
    @Param("goalId") goalId: string,
    @Param("cardId") cardId: string,
    @Body() body: unknown
  ) {
    return this.rewardsService.updateRewardCard(
      request.user!.id,
      goalId,
      cardId,
      body
    );
  }

  @Delete(":cardId")
  deleteCard(
    @Req() request: AuthenticatedRequest,
    @Param("goalId") goalId: string,
    @Param("cardId") cardId: string
  ) {
    return this.rewardsService.deleteRewardCard(request.user!.id, goalId, cardId);
  }
}
