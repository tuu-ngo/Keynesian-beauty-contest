"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { HostProjection, PlayerProjection, PublicProjection, StateResponse } from "@/contracts";
import { RoomClientError, authHeaders, stateUrl } from "@/lib/api/room-client";

type View = StateResponse["view"];
type ProjectionByView = {
  public: PublicProjection;
  player: PlayerProjection;
  host: HostProjection;
};

export type ConnectionState = "connecting" | "live" | "reconnecting";

type RoomStateOptions = {
  code: string;
  view: View;
  playerToken?: string | null;
  pauseWhenHidden?: boolean;
};

const etags = new Map<string, string>();

function cacheKey(code: string, view: View, token?: string | null) {
  return `${code.toUpperCase()}:${view}:${token ?? "anonymous"}`;
}

export function useRoomState<V extends View>({ code, view, playerToken, pauseWhenHidden = view === "player" }: RoomStateOptions & { view: V }) {
  const [data, setData] = useState<ProjectionByView[V] | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [error, setError] = useState<RoomClientError | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const retryDelay = useRef(1000);
  const timer = useRef<number | null>(null);
  const dataRef = useRef<ProjectionByView[V] | null>(null);
  const optionsRef = useRef({ code, view, playerToken, pauseWhenHidden });
  optionsRef.current = { code, view, playerToken, pauseWhenHidden };

  const clearTimer = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const refresh = useCallback(async () => {
    const active = optionsRef.current;
    if (active.pauseWhenHidden && document.visibilityState === "hidden") return;
    if (inFlight.current) return;
    const controller = new AbortController();
    inFlight.current = controller;
    const key = cacheKey(active.code, active.view, active.playerToken);
    try {
      const response = await fetch(stateUrl(active.code, active.view), {
        headers: {
          ...authHeaders(active.view === "player" ? active.playerToken : null),
          ...(etags.get(key) ? { "If-None-Match": etags.get(key)! } : {}),
        },
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.status === 304) {
        setConnection("live");
        setError(null);
        retryDelay.current = 1000;
        return;
      }
      const payload = await response.json().catch(() => null) as ProjectionByView[V] | { error?: { code?: string; message?: string } } | null;
      if (!response.ok) {
        throw new RoomClientError({
          code: (payload as { error?: { code?: string } } | null)?.error?.code ?? "REQUEST_FAILED",
          message: (payload as { error?: { message?: string } } | null)?.error?.message ?? "Could not update game state.",
          status: response.status,
        });
      }
      const next = payload as ProjectionByView[V];
      dataRef.current = next;
      setData(next);
      const tag = response.headers.get("ETag");
      if (tag) etags.set(`${active.code.toUpperCase()}:${active.view}:${active.playerToken ?? "anonymous"}`, tag);
      setConnection("live");
      setError(null);
      setLastUpdatedAt(Date.now());
      retryDelay.current = 1000;
    } catch (cause) {
      if (controller.signal.aborted) return;
      const problem = cause instanceof RoomClientError
        ? cause
        : new RoomClientError({ code: "NETWORK_ERROR", message: "Reconnecting. Showing the latest confirmed state.", status: 0 });
      setError(problem);
      setConnection(dataRef.current ? "reconnecting" : "connecting");
      retryDelay.current = Math.min(retryDelay.current * 2, 8000);
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
    }
  }, []);

  useEffect(() => {
    dataRef.current = null;
    setData(null);
    setError(null);
    setConnection("connecting");
    retryDelay.current = 1000;
    void refresh();
    const schedule = () => {
      clearTimer();
      const jitter = Math.floor(Math.random() * 180);
      timer.current = window.setTimeout(async () => {
        await refresh();
        schedule();
      }, retryDelay.current + jitter);
    };
    schedule();
    const resume = () => {
      if (document.visibilityState !== "hidden" || !pauseWhenHidden) void refresh();
    };
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      clearTimer();
      inFlight.current?.abort();
      inFlight.current = null;
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [clearTimer, code, pauseWhenHidden, playerToken, refresh, view]);

  return { data, connection, error, lastUpdatedAt, refresh };
}
