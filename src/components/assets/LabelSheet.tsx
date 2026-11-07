"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { PrinterIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { toolScanPath } from "~/lib/asset-tags";
import { api } from "~/trpc/react";

/**
 * Printable QR labels. Each code is a link to the tool's scan page, so any
 * phone camera opens the tool in ForemanHQ, and in-app scanners read the tag.
 */
export function LabelSheet({ ids }: { ids: string[] }) {
  const isOnline = useOnlineStatus();
  const tools = api.assets.listAssets.useQuery({ ids, limit: 1000 }, { enabled: isOnline && ids.length > 0 });
  const wanted = new Set(ids);
  const selected = (tools.data ?? []).filter((t) => wanted.has(t.id));
  const [codes, setCodes] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const origin = window.location.origin;
    void Promise.all(
      selected.map(async (tool) => [
        tool.id,
        await QRCode.toDataURL(`${origin}${toolScanPath(tool.assetTag)}`, {
          margin: 1,
          width: 240,
          errorCorrectionLevel: "M",
        }),
      ] as const),
    ).then((entries) => {
      if (!cancelled) setCodes(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected.map((t) => t.id).join(",")]);

  return (
    <div className="p-4 print:p-0">
      <style>{`@media print { header, nav, .no-print { display: none !important; } @page { margin: 8mm; } }`}</style>
      <div className="no-print mx-auto mb-4 flex max-w-4xl items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">QR labels</h2>
          <p className="text-muted-foreground text-sm">
            {selected.length} label{selected.length === 1 ? "" : "s"}. Print on label stock or plain paper and laminate.
          </p>
        </div>
        <Button onClick={() => window.print()} disabled={!selected.length}>
          <PrinterIcon className="mr-2 h-4 w-4" /> Print
        </Button>
      </div>
      {tools.isLoading && <p className="text-muted-foreground text-center text-sm">Loading…</p>}
      <div className="mx-auto grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-3 print:grid-cols-3 print:gap-2">
        {selected.map((tool) => (
          <div key={tool.id} className="flex break-inside-avoid items-center gap-2 rounded-md border border-black/40 bg-white p-2 text-black">
            {codes[tool.id] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={codes[tool.id]} alt={`QR code for ${tool.assetTag}`} className="h-24 w-24 shrink-0" />
            ) : (
              <div className="h-24 w-24 shrink-0 bg-gray-100" />
            )}
            <div className="min-w-0">
              <div className="font-mono text-lg leading-tight font-bold">{tool.assetTag}</div>
              <div className="line-clamp-3 text-xs leading-snug">{tool.name}</div>
              {tool.serialNumber && <div className="mt-0.5 truncate font-mono text-[10px]">S/N {tool.serialNumber}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
