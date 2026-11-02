export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
export function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value : null; }
export function integer(value: unknown): number | null { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null; }
export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 8000) return null;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
export function utcTime(value: unknown): string | null {
  if (typeof value !== "string" || !/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z| ?[+-]\d{2}:?\d{2})$/.test(value)) return null;
  const normalized = value.replace(" ", "T").replace(/ ([+-]\d{2}:?\d{2})$/, "$1");
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
export function moneyText(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? String(value) : null;
}
