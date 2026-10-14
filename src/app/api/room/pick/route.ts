import { NextResponse } from "next/server";
import { pickSchema } from "@/contracts";
import { bearerToken } from "@/lib/auth/player-session";
import { apiError, jsonRequired, roomError } from "@/lib/server/http";
import { allowRateLimit } from "@/lib/server/rate-limit";
import { authenticatePlayer, currentRoomForRead, putPick } from "@/lib/server/room-service";

export const runtime = "nodejs";

export async function PUT(request: Request) {
  if (!jsonRequired(request)) return apiError("VALIDATION_ERROR", "Content-Type must be application/json.");
  const body = pickSchema.safeParse(await request.json().catch(() => null));
  const token = bearerToken(request);
  if (!body.success) return apiError("VALIDATION_ERROR", "Invalid pick request.");
  if (!token) return apiError("UNAUTHENTICATED", "Player token required.");
  const room = await currentRoomForRead();
  if (!room) return apiError("ROOM_NOT_FOUND", "Room not found.");
  const authenticated = await authenticatePlayer(room.code, token);
  if (!authenticated) return apiError("UNAUTHENTICATED", "Player token is invalid or expired.");
  if (!(await allowRateLimit(`pick:${authenticated.tokenHash}`, 120, 60_000))) return apiError("RATE_LIMITED", "Too many pick requests.");
  try {
    const result = await putPick(room.code, authenticated.username, body.data);
    return NextResponse.json(result.result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return roomError(error);
  }
}
