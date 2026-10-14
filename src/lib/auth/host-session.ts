import { createHash, createHmac, timingSafeEqual } from "crypto";
import type { NextResponse } from "next/server";

const COOKIE_NAME = "beauty_host_session";
const SESSION_MS = 12 * 60 * 60 * 1000;

function secret() {
  const value = process.env.HOST_SESSION_SECRET;
  if (!value) throw new Error("HOST_SESSION_SECRET is not configured.");
  if (Buffer.byteLength(value) < 16) throw new Error("HOST_SESSION_SECRET must contain at least 128 bits of entropy.");
  if (process.env.NODE_ENV === "production" && value === "replace-with-a-random-32-byte-secret") {
    throw new Error("HOST_SESSION_SECRET must be replaced before production.");
  }
  return value;
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function equal(left: string, right: string) {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

function cookieValue(request: Request) {
  const match = request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function hasHostCredentials(username: string, password: string) {
  const expectedUsername = process.env.HOST_USERNAME;
  const expectedPassword = process.env.HOST_PASSWORD;
  if (!expectedUsername || !expectedPassword) return false;
  // Evaluate both comparisons even when the username is wrong, so the password
  // comparison does not become a remotely observable short-cut.
  const usernameMatches = equal(username, expectedUsername);
  const passwordMatches = equal(password, expectedPassword);
  return usernameMatches && passwordMatches;
}

export function isHostRequest(request: Request) {
  try {
    const value = cookieValue(request);
    if (!value) return false;
    const [payload, signature] = value.split(".");
    if (!payload || !signature || !equal(signature, sign(payload))) return false;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: number };
    return typeof data.exp === "number" && data.exp > Date.now();
  } catch {
    return false;
  }
}

export function setHostSession(response: NextResponse) {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_MS })).toString("base64url");
  response.cookies.set(COOKIE_NAME, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MS / 1000,
  });
  return response;
}

export function clearHostSession(response: NextResponse) {
  response.cookies.set(COOKIE_NAME, "", { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
  return response;
}
