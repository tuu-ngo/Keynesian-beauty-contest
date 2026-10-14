"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RoomClientError, roomRequest } from "@/lib/api/room-client";

type RoomShell = { code: string };

export function HostEntry() {
  const router = useRouter();
  const [mode, setMode] = useState<"checking" | "sign-in" | "create">("checking");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const loadRoom = useCallback(async () => {
    try {
      const room = await roomRequest<RoomShell>("/api/room");
      router.replace(`/host/${room.code}`);
    } catch (error) {
      if (error instanceof RoomClientError && error.problem.status === 404) setMode("create");
      else if (error instanceof RoomClientError && error.problem.status === 401) setMode("sign-in");
      else { setMode("sign-in"); setMessage("Could not check the host session. Try signing in again."); }
    }
  }, [router]);
  useEffect(() => { void loadRoom(); }, [loadRoom]);

  async function signIn(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      await roomRequest("/api/host/login", { method: "POST", body: { username, password } });
      setPassword(""); await loadRoom();
    } catch (error) { setMessage(error instanceof RoomClientError ? error.problem.message : "Could not sign in. Try again."); }
    finally { setBusy(false); }
  }
  async function createRoom() {
    setBusy(true); setMessage("");
    try { const room = await roomRequest<RoomShell>("/api/room", { method: "POST" }); router.replace(`/host/${room.code}`); }
    catch (error) { setMessage(error instanceof RoomClientError ? error.problem.message : "Could not create a room. Check the roster seed and try again."); }
    finally { setBusy(false); }
  }

  if (mode === "checking") return <main className="app-page app-page--loading"><div className="skeleton skeleton--title" /><p>Checking host session…</p></main>;
  if (mode === "create") return <main className="host-entry"><section><p className="wordmark">Keynesian Beauty Contest</p><h1>Room is ready when the <mark>roster</mark> is.</h1><p>The player roster is loaded from the seeded database and kept private from this screen.</p></section><section className="form-panel"><h2>Create the room</h2><p>Once created, this room keeps the roster snapshot for every new run.</p>{message && <p className="form-message" role="alert">{message}</p>}<button className="button button--primary" disabled={busy} onClick={() => void createRoom()}>{busy ? "Creating room…" : "Create room"}</button></section></main>;
  return <main className="host-entry"><section><p className="wordmark">Keynesian Beauty Contest</p><h1>Host the <mark>room</mark>.</h1><p>Control the rounds, reveal the outcome, and keep the live screen moving.</p></section><form className="form-panel" onSubmit={signIn}><h2>Host sign in</h2><label><span>Username</span><input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required /></label><label><span>Password</span><input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required /></label>{message && <p className="form-message" role="alert">{message}</p>}<button className="button button--primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button></form></main>;
}
