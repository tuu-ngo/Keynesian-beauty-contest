import { Suspense } from "react";
import { PlayerLoginForm } from "@/components/player/player-login-form";

export default function LoginPage() {
  // The form reads the optional `code` query parameter. App Router requires a
  // Suspense boundary around that client-side search-param read during static
  // prerendering.
  return <Suspense fallback={null}><PlayerLoginForm /></Suspense>;
}
