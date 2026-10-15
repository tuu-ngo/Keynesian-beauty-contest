"use client";

import { useEffect, useMemo, useState } from "react";
import type { ConnectionState } from "./use-room-state";

export function ConnectionStatus({ state }: { state: ConnectionState }) {
  const label = state === "live" ? "Live" : state === "reconnecting" ? "Reconnecting" : "Connecting";
  return <span className={`connection-status connection-status--${state}`} aria-live="polite"><span aria-hidden="true" />{label}</span>;
}

export function Countdown({ deadlineAt, serverNow, paused = false, pausedRemainingMs = null, className = "" }: { deadlineAt: string | null; serverNow: string; paused?: boolean; pausedRemainingMs?: number | null; className?: string }) {
  const start = useMemo(() => paused ? (pausedRemainingMs ?? 0) : Date.parse(deadlineAt ?? serverNow) - Date.parse(serverNow), [deadlineAt, paused, pausedRemainingMs, serverNow]);
  const [remaining, setRemaining] = useState(start);
  useEffect(() => {
    setRemaining(start);
    if (!deadlineAt || paused) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => setRemaining(Math.max(0, start - (Date.now() - startedAt))), 250);
    return () => window.clearInterval(timer);
  }, [deadlineAt, paused, start]);
  if (!deadlineAt) return <span className={className}>No time limit</span>;
  const totalSeconds = Math.ceil(Math.max(0, remaining) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const announcement = totalSeconds === 30 || totalSeconds === 10 || totalSeconds === 0 ? `${totalSeconds} seconds remaining` : undefined;
  return <span className={className} aria-label={`${minutes} minutes ${seconds} seconds remaining`}><span aria-live="polite" className="sr-only">{announcement}</span>{String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}</span>;
}

export function TeamMark({ color, name }: { color?: string; name: string }) {
  return <span className="team-mark" aria-label={`${name} team`} style={color ? { backgroundColor: color } : undefined} />;
}

export function Metric({ label, value, note, prominent = false }: { label: string; value: React.ReactNode; note?: React.ReactNode; prominent?: boolean }) {
  return <div className={`metric ${prominent ? "metric--prominent" : ""}`}><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>;
}

export function ScreenSkeleton({ portal = false }: { portal?: boolean }) {
  return <main className={portal ? "portal portal--loading" : "app-page app-page--loading"} aria-busy="true" aria-label="Loading game state">
    <div className="skeleton skeleton--line" /><div className="skeleton skeleton--title" /><div className="skeleton skeleton--panel" />
  </main>;
}
