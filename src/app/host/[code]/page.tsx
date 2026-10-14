import { HostClient } from "@/components/host/host-client";

export default async function HostConsolePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <HostClient code={code.toUpperCase()} />;
}
