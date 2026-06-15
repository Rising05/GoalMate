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
import { UploadsService } from "./uploads.service";

@Controller("uploads")
@UseGuards(AuthGuard)
export class UploadsController {
  constructor(
    @Inject(UploadsService)
    private readonly uploadsService: UploadsService
  ) {}

  @Post("evidence")
  createEvidenceUpload(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown
  ) {
    return this.uploadsService.createEvidenceUpload(request.user!.id, body);
  }

  @Get("evidence/:id")
  getEvidenceUpload(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string
  ) {
    return this.uploadsService.getEvidenceUpload(request.user!.id, id);
  }
}
