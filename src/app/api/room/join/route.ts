import { NextResponse } from "next/server";
import { joinSchema } from "@/contracts";
import { bearerToken } from "@/lib/auth/player-session";
import { apiError, jsonRequired, roomError } from "@/lib/server/http";
import { authenticatePlayer, currentRoomForRead, joinPlayer } from "@/lib/server/room-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!jsonRequired(request)) return apiError("VALIDATION_ERROR", "Content-Type must be application/json.");
  const body = joinSchema.safeParse(await request.json().catch(() => null));
  const token = bearerToken(request);
  if (!body.success) return apiError("VALIDATION_ERROR", "Invalid join request.");
  if (!token) return apiError("UNAUTHENTICATED", "Player token required.");
  const room = await currentRoomForRead();
  if (!room) return apiError("ROOM_NOT_FOUND", "Room not found.");
  const authenticated = await authenticatePlayer(room.code, token);
  if (!authenticated) return apiError("UNAUTHENTICATED", "Player token is invalid or expired.");
  try {
    const result = await joinPlayer(room.code, authenticated.username, body.data.runId);
    return NextResponse.json({ joined: result.joined, runId: result.room.run.id, version: result.room.version }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return roomError(error);
  }
}
