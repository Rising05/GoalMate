export function objectValue(value: unknown, field = "response"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`);
  return value as Record<string, unknown>;
}

export function stringValue(value: unknown, field: string, maxLength = 4000): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a string`);
  const result = value.trim();
  if (result.length > maxLength) throw new Error(`${field} exceeds ${maxLength} characters`);
  return result;
}

export function scoreValue(value: unknown, field: string): number {
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error(`${field} must be between 0 and 100`);
  return Math.round(score);
}

export function stringArray(value: unknown, field: string, min = 0, max = 10): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  const result = value.map((item, index) => stringValue(item, `${field}[${index}]`));
  if (result.length < min || result.length > max) throw new Error(`${field} must contain ${min}-${max} items`);
  return result;
}
