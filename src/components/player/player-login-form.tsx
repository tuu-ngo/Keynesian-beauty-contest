"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RoomClientError, roomRequest, savePlayerToken, stateUrl, getPlayerToken } from "@/lib/api/room-client";

type LoginResult = { playerToken: string; account: { username: string; displayName: string; teamId: string } };

export function PlayerLoginForm() {
  const router = useRouter();
  const query = useSearchParams();
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const fromPortal = query.get("code")?.trim().toUpperCase() ?? "";
    if (/^[A-Z]{4}$/.test(fromPortal)) setCode(fromPortal);
  }, [query]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedCode = code.trim().toUpperCase();
    const normalizedName = username.trim();
    if (!/^[A-Z]{4}$/.test(normalizedCode)) {
      setMessage("Enter the four-letter game code.");
      return;
    }
    if (!normalizedName || !password) {
      setMessage("Enter your username and password.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const restored = getPlayerToken(normalizedCode);
      if (restored) {
        const response = await fetch(stateUrl(normalizedCode, "player"), { headers: { Authorization: `Bearer ${restored}` }, cache: "no-store" });
        if (response.ok) {
          savePlayerToken(normalizedCode, restored);
          router.push(`/play/${normalizedCode}`);
          return;
        }
      }
      const result = await roomRequest<LoginResult>("/api/room/login", {
        method: "POST",
        body: { code: normalizedCode, username: normalizedName, password },
      });
      savePlayerToken(normalizedCode, result.playerToken);
      router.push(`/play/${normalizedCode}`);
    } catch (error) {
      if (error instanceof RoomClientError && error.problem.code === "INVALID_TRANSITION") {
        setMessage("Only participants who joined before round one can return to this game.");
      } else {
        setMessage(error instanceof RoomClientError ? "We could not sign you in. Check the room code, username, and password." : "Network connection failed. Your entries are still here; try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return <main className="login-page">
    <section className="login-intro">
      <p className="wordmark">Keynesian Beauty Contest</p>
      <div>
        <h1>Read the room.</h1>
        <p>Choose a number closest to the target based on the group&apos;s average.</p>
      </div>
      <Link href="/host" className="text-link">Host sign in</Link>
    </section>
    <section className="login-form-area">
      <form className="form-panel" onSubmit={submit} noValidate>
        <div>
          <h2>Join the game</h2>
          <p>Sign in with the roster account provided by your facilitator.</p>
        </div>
        <label>
          <span>Room code</span>
          <input autoFocus inputMode="text" autoCapitalize="characters" autoComplete="off" value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4))} placeholder="ABCD" maxLength={4} aria-describedby="room-code-help" />
          <small id="room-code-help">Four letters, shown on the public Portal.</small>
        </label>
        <label>
          <span>Username</span>
          <input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Your roster username" />
        </label>
        <label>
          <span>Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {message && <p className="form-message" role="alert">{message}</p>}
        <button className="button button--primary" disabled={busy}>{busy ? "Signing in…" : "Join game"}</button>
      </form>
    </section>
  </main>;
}
