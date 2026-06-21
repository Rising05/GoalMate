import { randomUUID } from "node:crypto";
import { Inject, Injectable, NestMiddleware } from "@nestjs/common";
import { HttpMetricsService } from "./http-metrics.service";
import { TraceContextService } from "./trace-context.service";

interface RequestLike {
  method: string;
  path: string;
  route?: { path?: string };
  header(name: string): string | undefined;
}

interface ResponseLike {
  statusCode: number;
  setHeader(name: string, value: string): void;
  once(event: "finish", listener: () => void): void;
}

const SAFE_ID = /^[A-Za-z0-9._:-]{8,128}$/;

@Injectable()
export class RequestTracingMiddleware implements NestMiddleware {
  constructor(
    @Inject(TraceContextService) private readonly traces: TraceContextService,
    @Inject(HttpMetricsService) private readonly metrics: HttpMetricsService
  ) {}

  use(request: RequestLike, response: ResponseLike, next: () => void) {
    const suppliedRequestId = request.header("x-request-id");
    const requestId = suppliedRequestId && SAFE_ID.test(suppliedRequestId) ? suppliedRequestId : randomUUID();
    const suppliedTraceId = request.header("x-trace-id");
    const traceId = suppliedTraceId && SAFE_ID.test(suppliedTraceId) ? suppliedTraceId : requestId;
    response.setHeader("x-request-id", requestId);
    response.setHeader("x-trace-id", traceId);
    if (request.header("authorization")) {
      response.setHeader("cache-control", "no-store, private");
      response.setHeader("vary", "Authorization");
    }
    const startedAt = performance.now();

    this.traces.run({ requestId, traceId }, () => {
      response.once("finish", () => {
        const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
        this.metrics.observe(response.statusCode, durationMs);
        process.stdout.write(`${JSON.stringify({ level: "info", event: "http_request", requestId, traceId, method: request.method, path: request.route?.path ?? request.path, statusCode: response.statusCode, durationMs, timestamp: new Date().toISOString() })}\n`);
      });
      next();
    });
  }
}
