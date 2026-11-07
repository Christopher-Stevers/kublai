import { EstimatesList } from "~/components/estimating/EstimatesList";
import { EstimatingAccess } from "~/components/estimating/EstimatingAccess";
import { requireEstimatingPage } from "~/server/estimating/page-access";

export default async function EstimatingPage() {
  await requireEstimatingPage();
  return (
    <EstimatingAccess>
      <EstimatesList />
    </EstimatingAccess>
  );
}
