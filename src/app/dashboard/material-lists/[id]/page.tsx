"use client";
import { use } from "react";
import { usePathname } from "next/navigation";
import { MaterialListScreen } from "~/components/materialLists/MaterialListScreen";

export default function MaterialListDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: paramId } = use(params);
  const pathname = usePathname();
  const id =
    pathname.match(/^\/dashboard\/material-lists\/([^/?#]+)/)?.[1] ?? paramId;
  return <MaterialListScreen id={id} />;
}
