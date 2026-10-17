import { redirect } from "next/navigation";

export default async function ToolRequestsPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  redirect(`/dashboard/jobs/${encodeURIComponent(jobId)}/material-lists`);
}
