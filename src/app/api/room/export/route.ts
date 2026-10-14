import { NextRequest, NextResponse } from "next/server";
import { isHostRequest } from "@/lib/auth/host-session";
import { csvForArchive, publicArchive } from "@/lib/room";
import { apiError } from "@/lib/server/http";
import { currentRoomForRead } from "@/lib/server/room-service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!isHostRequest(request)) return apiError("UNAUTHENTICATED", "Host login required.");
  const format = request.nextUrl.searchParams.get("format") ?? "json";
  if (format !== "json" && format !== "csv") return apiError("VALIDATION_ERROR", "Format must be json or csv.");
  const room = await currentRoomForRead();
  if (!room) return apiError("ROOM_NOT_FOUND", "Room not found.");
  const requestedRun = request.nextUrl.searchParams.get("runId") ?? room.run.id;
  const archive = requestedRun === room.run.id ? publicArchive(room, { hideOpenRoundPicks: true }) : room.archives.find((candidate) => candidate.runId === requestedRun)?.archive;
  if (!archive) return apiError("RUN_NOT_FOUND", "Run is not available for export.");
  if (format === "csv") {
    return new NextResponse(csvForArchive(archive), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="results-${archive.run.id}.csv"`, "Cache-Control": "no-store" },
    });
  }
  return new NextResponse(JSON.stringify(archive), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="game-${archive.run.id}.json"`, "Cache-Control": "no-store" },
  });
}
