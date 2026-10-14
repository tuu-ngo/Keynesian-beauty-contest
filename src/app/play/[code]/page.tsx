import { PlayerClient } from "@/components/player/player-client";

export default async function PlayPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <PlayerClient code={code.toUpperCase()} />;
}
