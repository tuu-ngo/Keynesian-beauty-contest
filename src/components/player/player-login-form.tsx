"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RoomClientError, roomRequest, savePlayerToken, stateUrl, getPlayerToken } from "@/lib/api/room-client";

type JoinResult = { playerToken: string; account: { username: string; displayName: string; teamId: string } };

const NAME_MAX = 20;

export function PlayerLoginForm() {
  const router = useRouter();
  const query = useSearchParams();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const fromPortal = query.get("code")?.trim().toUpperCase() ?? "";
    if (/^[A-Z]{4}$/.test(fromPortal)) setCode(fromPortal);
  }, [query]);

  // A returning player with a stored token goes straight back to their game.
  useEffect(() => {
    if (!/^[A-Z]{4}$/.test(code)) return;
    const restored = getPlayerToken(code);
    if (!restored) return;
    let active = true;
    void fetch(stateUrl(code, "player"), { headers: { Authorization: `Bearer ${restored}` }, cache: "no-store" })
      .then((response) => { if (response.ok && active) router.push(`/play/${code}`); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [code, router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedCode = code.trim().toUpperCase();
    const normalizedName = name.replace(/\s+/g, " ").trim();
    if (!/^[A-Z]{4}$/.test(normalizedCode)) {
      setMessage("Enter the four-letter game code.");
      return;
    }
    if (!normalizedName) {
      setMessage("Enter a nickname.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await roomRequest<JoinResult>("/api/room/login", {
        method: "POST",
        body: { code: normalizedCode, name: normalizedName },
      });
      savePlayerToken(normalizedCode, result.playerToken);
      router.push(`/play/${normalizedCode}`);
    } catch (error) {
      if (!(error instanceof RoomClientError)) setMessage("Network connection failed. Your entries are still here; try again.");
      else if (error.problem.code === "NAME_TAKEN") setMessage("That nickname is already taken in this game. Try another one.");
      else if (error.problem.code === "INVALID_TRANSITION") setMessage("This game has already started. You can join when the host starts a new game.");
      else if (error.problem.code === "ROOM_NOT_FOUND") setMessage("We could not find that game. Check the room code.");
      else setMessage(error.problem.message);
    } finally {
      setBusy(false);
    }
  }

  return <main className="login-page">
    <section className="login-intro">
      <p className="wordmark">Keynesian Beauty Contest</p>
      <div>
        <h1>Read the <mark>room</mark>.</h1>
        <p>Choose a number closest to the target based on the group&apos;s average.</p>
      </div>
      <Link href="/host" className="text-link">Host sign in</Link>
    </section>
    <section className="login-form-area">
      <form className="form-panel" onSubmit={submit} noValidate>
        <div>
          <h2>Join the game</h2>
          <p>Enter the room code and pick a nickname. No account needed.</p>
        </div>
        <label>
          <span>Room code</span>
          <input autoFocus inputMode="text" autoCapitalize="characters" autoComplete="off" value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4))} placeholder="ABCD" maxLength={4} aria-describedby="room-code-help" />
          <small id="room-code-help">Four letters, shown on the public Portal.</small>
        </label>
        <label>
          <span>Nickname</span>
          <input autoComplete="nickname" value={name} onChange={(event) => setName(event.target.value.slice(0, NAME_MAX))} placeholder="Shown on the Portal" maxLength={NAME_MAX} />
        </label>
        {message && <p className="form-message" role="alert">{message}</p>}
        <button className="button button--primary" disabled={busy}>{busy ? "Joining…" : "Join game"}</button>
      </form>
    </section>
  </main>;
}
