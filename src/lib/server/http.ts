import { NextResponse } from "next/server";
import { RoomError } from "@/lib/room";

const STATUS_BY_CODE: Record<string, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  ROOM_NOT_FOUND: 404,
  RUN_NOT_FOUND: 404,
  INVALID_TRANSITION: 409,
  VERSION_CONFLICT: 409,
  ROOM_EXISTS: 409,
  RUN_MISMATCH: 409,
  JOIN_REQUIRED: 409,
  NAME_TAKEN: 409,
  ROOM_FULL: 409,
  RUN_EXPIRED: 410,
  RATE_LIMITED: 429,
};

export function apiError(code: string, message: string, status = STATUS_BY_CODE[code] ?? 500, meta?: Record<string, unknown>) {
  return NextResponse.json({ error: { code, message, ...(meta ? { meta } : {}) } }, { status, headers: { "Cache-Control": "no-store" } });
}

export function roomError(error: unknown) {
  if (error instanceof RoomError) return apiError(error.code, error.message, STATUS_BY_CODE[error.code] ?? 409);
  if (error instanceof Error && ["VERSION_CONFLICT", "ROOM_NOT_FOUND", "ROOM_EXISTS", "UNAUTHENTICATED"].includes(error.message)) {
    return apiError(error.message, error.message === "VERSION_CONFLICT" ? "State changed; refresh and retry." : error.message.replaceAll("_", " "));
  }
  return apiError("INTERNAL_ERROR", "An unexpected server error occurred.");
}

export function jsonRequired(request: Request): boolean {
  const contentType = request.headers.get("content-type");
  return Boolean(contentType?.toLowerCase().startsWith("application/json"));
}

export function validHostOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  // Non-browser clients do not send Origin. Browser cookie writes must match the
  // configured app origin, protecting the Host session from cross-site requests.
  if (!origin) return true;
  const configured = process.env.NEXT_PUBLIC_BASE_URL;
  if (configured) {
    try {
      return new URL(origin).origin === new URL(configured).origin;
    } catch {
      return false;
    }
  }
  try {
    const host = request.headers.get("host");
    return host !== null && new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function etag(parts: string[]): string {
  return `"${parts.join("-")}"`;
}
