import { Controller, Get, Header, Headers, Inject, OnModuleInit, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { SystemMetricsService } from "./system-metrics.service";

@Controller()
export class ObservabilityController implements OnModuleInit {
  constructor(@Inject(SystemMetricsService) private readonly metrics: SystemMetricsService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === "production" && !process.env.METRICS_TOKEN?.trim()) {
      throw new Error("METRICS_TOKEN is required in production");
    }
  }

  @Get("health/readiness")
  async readiness() {
    const result = await this.metrics.readiness();
    if (result.status !== "ready") throw new ServiceUnavailableException(result);
    return result;
  }

  @Get("metrics")
  @Header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
  metricsEndpoint(@Headers("authorization") authorization?: string) {
    const token = process.env.METRICS_TOKEN?.trim();
    if (token && authorization !== `Bearer ${token}`) throw new UnauthorizedException("Invalid metrics token");
    return this.metrics.toPrometheus();
  }
}
