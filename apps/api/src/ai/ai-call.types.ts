export interface AiCallContext {
  userId: string;
  goalId?: string;
  aiJobId?: string;
  attempt?: number;
  fallbackUsed?: boolean;
}

export type AiErrorCategory =
  | "CONFIGURATION"
  | "TIMEOUT"
  | "RATE_LIMIT"
  | "PROVIDER_HTTP"
  | "EMPTY_RESPONSE"
  | "INVALID_JSON"
  | "SCHEMA_VALIDATION"
  | "UNKNOWN";

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly category: AiErrorCategory,
    readonly retryable: boolean,
    readonly statusCode?: number
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

export interface AiJsonCall<T> {
  capability: string;
  promptVersion: string;
  systemPrompt: string;
  input: unknown;
  context: AiCallContext;
  validate: (value: unknown) => T;
  temperature?: number;
  timeoutMs?: number;
}
