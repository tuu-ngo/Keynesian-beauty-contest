import { NextResponse } from "next/server";
import { isHostRequest } from "@/lib/auth/host-session";
import { apiError } from "@/lib/server/http";
import { currentRoomForRead } from "@/lib/server/room-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isHostRequest(request)) return apiError("UNAUTHENTICATED", "Host login required.");
  const room = await currentRoomForRead();
  if (!room) return apiError("ROOM_NOT_FOUND", "Room not found.");
  return NextResponse.json(room.archives.map(({ runId, runNumber, endedAt, reason, expiresAt }) => ({ runId, runNumber, endedAt, reason, expiresAt })), { headers: { "Cache-Control": "no-store" } });
}
