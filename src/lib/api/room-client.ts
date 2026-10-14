"use client";

import type { StateResponse } from "@/contracts";

export type ApiProblem = {
  code: string;
  message: string;
  status: number;
};

export class RoomClientError extends Error {
  constructor(public readonly problem: ApiProblem) {
    super(problem.message);
    this.name = "RoomClientError";
  }
}

type ApiOptions = Omit<RequestInit, "body"> & { body?: unknown };

export async function roomRequest<T>(url: string, options: ApiOptions = {}): Promise<T> {
  const { body, headers, ...init } = options;
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => null) as T | { error?: { code?: string; message?: string } } | null;
  if (!response.ok) {
    const error = payload as { error?: { code?: string; message?: string } } | null;
    throw new RoomClientError({
      code: error?.error?.code ?? "REQUEST_FAILED",
      message: error?.error?.message ?? "Something went wrong. Please try again.",
      status: response.status,
    });
  }
  return payload as T;
}

export function playerTokenKey(code: string) {
  return `beauty-player-${code.toUpperCase()}`;
}

export function getPlayerToken(code: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(playerTokenKey(code));
}

export function savePlayerToken(code: string, token: string) {
  window.localStorage.setItem(playerTokenKey(code), token);
  window.localStorage.setItem("beauty-player-last-room", code.toUpperCase());
}

export function removePlayerToken(code: string) {
  window.localStorage.removeItem(playerTokenKey(code));
}

export function stateUrl(code: string, view: StateResponse["view"]) {
  return `/api/room/state?code=${encodeURIComponent(code.toUpperCase())}&view=${view}`;
}

export function authHeaders(token: string | null | undefined): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function formatApiProblem(error: unknown, fallback = "Something went wrong. Please try again.") {
  return error instanceof RoomClientError ? error.problem.message : fallback;
}
