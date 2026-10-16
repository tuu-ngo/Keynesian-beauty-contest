import { NextResponse } from "next/server";
import { z } from "zod";
import { hasHostCredentials, setHostSession } from "@/lib/auth/host-session";
import { apiError, jsonRequired, serverProblem, validHostOrigin } from "@/lib/server/http";
import { allowRateLimit, requestIp } from "@/lib/server/rate-limit";

const credentialsSchema = z.object({ username: z.string().min(1), password: z.string().min(1) });

export async function POST(request: Request) {
  if (!validHostOrigin(request)) return apiError("FORBIDDEN", "Invalid request origin.");
  if (!jsonRequired(request)) return apiError("VALIDATION_ERROR", "Content-Type must be application/json.");
  const parsed = credentialsSchema.safeParse(await request.json().catch(() => null));
  try {
    if (!(await allowRateLimit(`host-login:${requestIp(request)}`, 10, 60_000))) return apiError("RATE_LIMITED", "Too many login attempts.");
    if (!parsed.success || !hasHostCredentials(parsed.data.username, parsed.data.password)) {
      return apiError("UNAUTHENTICATED", "Incorrect username or password.");
    }
    return setHostSession(NextResponse.json({ authenticated: true }, { headers: { "Cache-Control": "no-store" } }));
  } catch (error) {
    // Without this the Host only sees "Something went wrong" for a deployment problem.
    return serverProblem(error);
  }
}
