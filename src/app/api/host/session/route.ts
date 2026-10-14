import { NextResponse } from "next/server";
import { isHostRequest } from "@/lib/auth/host-session";

export async function GET(request: Request) {
  return NextResponse.json({ authenticated: isHostRequest(request) }, { headers: { "Cache-Control": "no-store" } });
}
