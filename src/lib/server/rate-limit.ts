import { getRoomStore } from "@/lib/store";

/** Durable bucket shared by all local processes and deployed Functions. */
export async function allowRateLimit(scope: string, limit: number, windowMs: number, now = Date.now()): Promise<boolean> {
  return getRoomStore().consumeRateLimit(scope, limit, windowMs, now);
}

export function requestIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}
