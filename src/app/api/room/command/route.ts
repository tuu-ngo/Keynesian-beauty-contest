import { NextResponse } from "next/server";
import { hostCommandSchema } from "@/contracts";
import { isHostRequest } from "@/lib/auth/host-session";
import { RoomError } from "@/lib/room";
import { apiError, jsonRequired, roomError, validHostOrigin } from "@/lib/server/http";
import { allowRateLimit, requestIp } from "@/lib/server/rate-limit";
import { commandRoom, currentRoomForRead } from "@/lib/server/room-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isHostRequest(request)) return apiError("UNAUTHENTICATED", "Host login required.");
  if (!validHostOrigin(request)) return apiError("FORBIDDEN", "Invalid request origin.");
  if (!jsonRequired(request)) return apiError("VALIDATION_ERROR", "Content-Type must be application/json.");
  const body = hostCommandSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return apiError("VALIDATION_ERROR", "Invalid host command.");
  if (!(await allowRateLimit(`host-command:${requestIp(request)}`, 30, 60_000))) return apiError("RATE_LIMITED", "Too many host commands.");
  const room = await currentRoomForRead();
  if (!room) return apiError("ROOM_NOT_FOUND", "Room not found.");
  try {
    const result = await commandRoom(room.code, body.data);
    return NextResponse.json(result.result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if ((error instanceof RoomError && error.code === "VERSION_CONFLICT") || (error instanceof Error && error.message === "VERSION_CONFLICT")) {
      const latest = await currentRoomForRead();
      return apiError("VERSION_CONFLICT", "State changed; refresh and retry.", 409, latest ? { version: latest.version, runId: latest.run.id } : undefined);
    }
    return roomError(error);
  }
}
