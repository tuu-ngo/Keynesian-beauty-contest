// Portal: read-only projected screen, 16:9. TODO: README section 2.3.
// Must never receive other players' picks before the reveal (enforced server-side).
export default async function PortalPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return (
    <main className="flex h-screen w-screen flex-col items-center justify-center gap-6">
      <h1 className="text-7xl font-bold">Keynesian Beauty Contest</h1>
      <p className="text-4xl text-[var(--muted)]">Game {code}</p>
    </main>
  );
}
