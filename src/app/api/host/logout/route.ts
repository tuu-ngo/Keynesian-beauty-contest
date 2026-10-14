import { NextResponse } from "next/server";
import { clearHostSession, isHostRequest } from "@/lib/auth/host-session";
import { apiError, validHostOrigin } from "@/lib/server/http";

export async function POST(request: Request) {
  if (!isHostRequest(request)) return apiError("UNAUTHENTICATED", "Host login required.");
  if (!validHostOrigin(request)) return apiError("FORBIDDEN", "Invalid request origin.");
  return clearHostSession(NextResponse.json({ authenticated: false }, { headers: { "Cache-Control": "no-store" } }));
}
