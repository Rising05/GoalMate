import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  StreamableFile,
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

  @Put("evidence/:id/upload")
  async uploadEvidenceContent(
    @Req() request: AuthenticatedRequest & AsyncIterable<Buffer>,
    @Param("id") id: string,
    @Query("expires") expires: string,
    @Query("signature") signature: string,
    @Headers("content-type") contentType?: string
  ) {
    const chunks: Buffer[] = [];

    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return this.uploadsService.storeEvidenceContent(
      request.user!.id,
      id,
      expires,
      signature,
      contentType,
      Buffer.concat(chunks)
    );
  }

  @Get("evidence/:id/download")
  async downloadEvidenceContent(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Query("expires") expires: string,
    @Query("signature") signature: string
  ) {
    const result = await this.uploadsService.readEvidenceContent(
      request.user!.id,
      id,
      expires,
      signature
    );

    return new StreamableFile(result.content, {
      type: result.asset.mimeType,
      disposition: `attachment; filename="${encodeURIComponent(result.asset.fileName)}"`
    });
  }

  @Delete("evidence/:id")
  deleteEvidenceUpload(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string
  ) {
    return this.uploadsService.deleteEvidenceUpload(request.user!.id, id);
  }
}
