import { NextResponse } from "next/server";
import { isHostRequest } from "@/lib/auth/host-session";
import { apiError, roomError, validHostOrigin } from "@/lib/server/http";
import { createSingletonRoom, currentRoomForRead } from "@/lib/server/room-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isHostRequest(request)) return apiError("UNAUTHENTICATED", "Host login required.");
  const room = await currentRoomForRead();
  if (!room) return apiError("ROOM_NOT_FOUND", "No room has been created.");
  return NextResponse.json({ code: room.code, runId: room.run.id, runNumber: room.run.number, version: room.version }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isHostRequest(request)) return apiError("UNAUTHENTICATED", "Host login required.");
  if (!validHostOrigin(request)) return apiError("FORBIDDEN", "Invalid request origin.");
  try {
    const room = await createSingletonRoom();
    return NextResponse.json({ code: room.code, runId: room.run.id, version: room.version }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && (error.message.startsWith("Roster seed") || error.message.startsWith("Seed roster"))) {
      return apiError("VALIDATION_ERROR", error.message);
    }
    return roomError(error);
  }
}
