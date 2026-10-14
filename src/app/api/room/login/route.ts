import { NextResponse } from "next/server";
import { playerLoginSchema } from "@/contracts";
import { apiError, jsonRequired, roomError } from "@/lib/server/http";
import { allowRateLimit, requestIp } from "@/lib/server/rate-limit";
import { loginPlayer } from "@/lib/server/room-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!jsonRequired(request)) return apiError("VALIDATION_ERROR", "Content-Type must be application/json.");
  const body = playerLoginSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return apiError("VALIDATION_ERROR", "Invalid login request.");
  const scope = `player-login:${requestIp(request)}:${body.data.username.trim().toLowerCase()}`;
  if (!(await allowRateLimit(scope, 10, 60_000))) return apiError("RATE_LIMITED", "Too many login attempts.");
  try {
    const result = await loginPlayer(body.data);
    return NextResponse.json({ playerToken: result.playerToken, account: result.account, joined: result.joined, runId: result.room.run.id, version: result.room.version }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return roomError(error);
  }
}
