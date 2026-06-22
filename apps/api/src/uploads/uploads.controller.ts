import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  PayloadTooLargeException,
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
    let receivedBytes = 0;

    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      receivedBytes += buffer.length;
      if (receivedBytes > 10 * 1024 * 1024) {
        throw new PayloadTooLargeException("上传内容超过 10MB 限制");
      }
      chunks.push(buffer);
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

  @Post("evidence/:id/complete")
  completeEvidenceUpload(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string
  ) {
    return this.uploadsService.completeEvidenceUpload(request.user!.id, id);
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
