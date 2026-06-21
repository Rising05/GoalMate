import { AsyncLocalStorage } from "node:async_hooks";
import { Injectable } from "@nestjs/common";

interface TraceStore {
  traceId: string;
  requestId: string;
}

@Injectable()
export class TraceContextService {
  private readonly storage = new AsyncLocalStorage<TraceStore>();

  run<T>(store: TraceStore, callback: () => T): T {
    return this.storage.run(store, callback);
  }

  getTraceId() {
    return this.storage.getStore()?.traceId;
  }

  getRequestId() {
    return this.storage.getStore()?.requestId;
  }
}
