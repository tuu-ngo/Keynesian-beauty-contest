import { PortalClient } from "@/components/portal/portal-client";

export default async function PortalPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <PortalClient code={code.toUpperCase()} />;
}
