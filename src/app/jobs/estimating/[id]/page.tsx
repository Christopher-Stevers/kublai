import { EstimateWorkspace } from "~/components/estimating/EstimateWorkspace";
import { EstimatingAccess } from "~/components/estimating/EstimatingAccess";
import { requireEstimatingPage } from "~/server/estimating/page-access";

export default async function EstimatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireEstimatingPage();
  const { id } = await params;
  return (
    <EstimatingAccess>
      <EstimateWorkspace id={id} />
    </EstimatingAccess>
  );
}
