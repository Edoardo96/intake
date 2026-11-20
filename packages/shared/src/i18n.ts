/**
 * Lays a translation over the Italian texts: every text the translation has replaces the Italian one, and a text it
 * lacks stays Italian. Objects are merged key by key; strings, functions and arrays are taken whole.
 */
export function withFallback<T>(base: T, over: unknown): T {
  const isMap = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  if (!isMap(base) || !isMap(over)) return (over ?? base) as T;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(over)) merged[key] = withFallback(merged[key], value);
  return merged as T;
}
