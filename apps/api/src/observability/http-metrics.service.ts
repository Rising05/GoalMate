import { Injectable } from "@nestjs/common";

const LATENCY_BUCKETS_MS = [50, 100, 250, 500, 1000, 2500, 5000, 10000];

@Injectable()
export class HttpMetricsService {
  private requestCount = 0;
  private totalDurationMs = 0;
  private readonly statusCounts = new Map<string, number>();
  private readonly bucketCounts = new Map<number, number>(LATENCY_BUCKETS_MS.map((bucket) => [bucket, 0]));

  observe(statusCode: number, durationMs: number) {
    this.requestCount += 1;
    this.totalDurationMs += durationMs;
    const statusClass = `${Math.floor(statusCode / 100)}xx`;
    this.statusCounts.set(statusClass, (this.statusCounts.get(statusClass) ?? 0) + 1);
    for (const bucket of LATENCY_BUCKETS_MS) {
      if (durationMs <= bucket) this.bucketCounts.set(bucket, (this.bucketCounts.get(bucket) ?? 0) + 1);
    }
  }

  toPrometheus() {
    const lines = [
      "# HELP goalmate_http_requests_total Total HTTP requests.",
      "# TYPE goalmate_http_requests_total counter",
      `goalmate_http_requests_total ${this.requestCount}`,
      "# TYPE goalmate_http_responses_total counter"
    ];
    for (const [statusClass, count] of this.statusCounts) lines.push(`goalmate_http_responses_total{status_class="${statusClass}"} ${count}`);
    lines.push("# TYPE goalmate_http_request_duration_ms histogram");
    for (const bucket of LATENCY_BUCKETS_MS) lines.push(`goalmate_http_request_duration_ms_bucket{le="${bucket}"} ${this.bucketCounts.get(bucket) ?? 0}`);
    lines.push(`goalmate_http_request_duration_ms_bucket{le="+Inf"} ${this.requestCount}`);
    lines.push(`goalmate_http_request_duration_ms_sum ${this.totalDurationMs}`);
    lines.push(`goalmate_http_request_duration_ms_count ${this.requestCount}`);
    return lines.join("\n");
  }
}
