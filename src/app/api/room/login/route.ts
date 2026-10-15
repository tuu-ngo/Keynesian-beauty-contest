import { NextResponse } from "next/server";
import { playerJoinByNameSchema } from "@/contracts";
import { apiError, jsonRequired, roomError } from "@/lib/server/http";
import { allowRateLimit, requestIp } from "@/lib/server/rate-limit";
import { joinByName } from "@/lib/server/room-service";

export const runtime = "nodejs";

/** Players do not sign in: entering a name in the lobby creates their identity and token. */
export async function POST(request: Request) {
  if (!jsonRequired(request)) return apiError("VALIDATION_ERROR", "Content-Type must be application/json.");
  const body = playerJoinByNameSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return apiError("VALIDATION_ERROR", "Invalid join request.");
  // A classroom often shares one public IP, so the per-IP budget must cover a full room.
  if (!(await allowRateLimit(`player-join:${requestIp(request)}`, 240, 60_000))) return apiError("RATE_LIMITED", "Too many join attempts.");
  try {
    const result = await joinByName(body.data);
    return NextResponse.json({ playerToken: result.playerToken, account: result.account, runId: result.room.run.id, version: result.room.version }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return roomError(error);
  }
}
