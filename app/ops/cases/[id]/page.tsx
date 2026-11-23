import Investigation from "@/components/ops/Investigation";
export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  return <Investigation id={(await params).id} />;
}
