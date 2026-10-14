import { NextRequest, NextResponse } from "next/server";
import { roomCodeSchema } from "@/contracts";
import { bearerToken } from "@/lib/auth/player-session";
import { project } from "@/lib/room";
import { apiError, etag } from "@/lib/server/http";
import { authenticatePlayer, roomForRead } from "@/lib/server/room-service";
import { isHostRequest } from "@/lib/auth/host-session";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const codeResult = roomCodeSchema.safeParse(request.nextUrl.searchParams.get("code")?.toUpperCase());
  const requestedView = request.nextUrl.searchParams.get("view") ?? "public";
  if (!codeResult.success || !["public", "player", "host"].includes(requestedView)) {
    return apiError("VALIDATION_ERROR", "Invalid room code or state view.");
  }
  const view = requestedView as "public" | "player" | "host";
  const code = codeResult.data;
  const now = Date.now();
  let username: string | undefined;
  let tokenDiscriminator = "public";
  if (view === "host") {
    if (!isHostRequest(request)) return apiError("UNAUTHENTICATED", "Host login required.");
    tokenDiscriminator = "host";
  } else if (view === "player") {
    const token = bearerToken(request);
    if (!token) return apiError("UNAUTHENTICATED", "Player token required.");
    const authenticated = await authenticatePlayer(code, token, now);
    if (!authenticated) return apiError("UNAUTHENTICATED", "Player token is invalid or expired.");
    username = authenticated.username;
    tokenDiscriminator = authenticated.tokenHash.slice(0, 16);
  }
  const room = await roomForRead(code, now);
  if (!room) return apiError("ROOM_NOT_FOUND", "Room not found.");
  try {
    const response = project(room, view, now, username);
    const tag = etag([String(room.version), view, room.run.id, tokenDiscriminator]);
    if (request.headers.get("if-none-match") === tag) return new NextResponse(null, { status: 304, headers: { ETag: tag, "Cache-Control": "private, no-cache" } });
    return NextResponse.json(response, { headers: { ETag: tag, "Cache-Control": view === "public" ? "private, no-cache" : "no-store" } });
  } catch {
    return apiError("FORBIDDEN", "Join the current run before using the player view.");
  }
}
