import { Global, Module } from "@nestjs/common";
import { HttpMetricsService } from "./http-metrics.service";
import { RequestTracingMiddleware } from "./request-tracing.middleware";
import { TraceContextService } from "./trace-context.service";
import { QueueModule } from "../queue/queue.module";
import { ObservabilityController } from "./observability.controller";
import { SystemMetricsService } from "./system-metrics.service";
import { QueueReconciliationService } from "./queue-reconciliation.service";
import { APP_FILTER } from "@nestjs/core";
import { SanitizedExceptionFilter } from "./sanitized-exception.filter";

@Global()
@Module({
  imports: [QueueModule],
  controllers: [ObservabilityController],
  providers: [
    TraceContextService,
    HttpMetricsService,
    RequestTracingMiddleware,
    SystemMetricsService,
    QueueReconciliationService,
    { provide: APP_FILTER, useClass: SanitizedExceptionFilter }
  ],
  exports: [TraceContextService, HttpMetricsService, RequestTracingMiddleware, SystemMetricsService, QueueReconciliationService]
})
export class ObservabilityModule {}
