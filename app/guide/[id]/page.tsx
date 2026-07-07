import GuideViewer from "@/components/GuideViewer";

export default async function GuidePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <GuideViewer id={id} />;
}
