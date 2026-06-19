import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";

@Injectable()
export class NotificationsScheduler implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(NotificationsService)
    private readonly notificationsService: NotificationsService
  ) {}

  onModuleInit() {
    if (process.env.NOTIFICATIONS_SCHEDULER_ENABLED !== "true") {
      return;
    }

    const configuredInterval = Number(
      process.env.NOTIFICATIONS_SCHEDULER_INTERVAL_MS ?? 60_000
    );
    const interval = Number.isFinite(configuredInterval)
      ? Math.max(10_000, configuredInterval)
      : 60_000;

    this.timer = setInterval(() => void this.tick(), interval);
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async tick(now = new Date()) {
    if (this.running) {
      return { skipped: true, reason: "Previous scheduler scan is still running." };
    }

    this.running = true;

    try {
      return await this.notificationsService.runDueNotificationScan({
        now: now.toISOString(),
        source: "AUTOMATIC"
      });
    } finally {
      this.running = false;
    }
  }
}
