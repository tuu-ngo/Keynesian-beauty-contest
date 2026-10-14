// Host console: round control, live player table, export. TODO: README sections 2.2 and 3.6.
export default async function HostConsolePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 p-6">
      <h1 className="text-3xl font-bold">Host console</h1>
      <p className="text-[var(--muted)]">Game {code}</p>
    </main>
  );
}
