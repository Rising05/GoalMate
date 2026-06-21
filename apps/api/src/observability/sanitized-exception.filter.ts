import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Inject } from "@nestjs/common";
import { TraceContextService } from "./trace-context.service";

interface ResponseLike {
  status(code: number): ResponseLike;
  json(body: unknown): void;
}

@Catch()
export class SanitizedExceptionFilter implements ExceptionFilter {
  constructor(@Inject(TraceContextService) private readonly traces: TraceContextService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<ResponseLike>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const errorType = exception instanceof Error ? exception.constructor.name : "UnknownError";
    process.stderr.write(`${JSON.stringify({ level: status >= 500 ? "error" : "warn", event: "http_exception", requestId: this.traces.getRequestId(), traceId: this.traces.getTraceId(), statusCode: status, errorType, timestamp: new Date().toISOString() })}\n`);
    if (exception instanceof HttpException) {
      response.status(status).json(exception.getResponse());
      return;
    }
    response.status(status).json({ statusCode: status, error: "Internal Server Error", requestId: this.traces.getRequestId() });
  }
}
