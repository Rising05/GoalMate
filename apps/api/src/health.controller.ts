import { Controller, Get } from "@nestjs/common";

@Controller()
export class HealthController {
  @Get("health")
  health() {
    return {
      status: "ok",
      service: "goalmate-api",
      version: "0.1.0",
      timestamp: new Date().toISOString()
    };
  }

  @Get()
  root() {
    return {
      name: "GoalPilot AI API",
      status: "ready",
      docs: "See SPEC.md for the product specification."
    };
  }
}

