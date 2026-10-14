"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function LandingRedirect() {
  const router = useRouter();
  useEffect(() => {
    const code = window.localStorage.getItem("beauty-player-last-room");
    router.replace(code && /^[A-Z]{4}$/.test(code) ? `/play/${code}` : "/login");
  }, [router]);
  return <main className="app-page app-page--loading" aria-label="Loading game"><div className="skeleton skeleton--title" /></main>;
}
