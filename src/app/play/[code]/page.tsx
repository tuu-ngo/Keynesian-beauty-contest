// Player view: lobby, submit a pick, own result. TODO: README section 2.1.
export default async function PlayPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-4">
      <h1 className="text-2xl font-bold">Player</h1>
      <p className="text-[var(--muted)]">Game {code}</p>
    </main>
  );
}
