import type { NativeRevitReport } from "~/lib/bim/native-conversion";

export function NativeConversionReport({
  report,
}: {
  report: NativeRevitReport;
}) {
  return (
    <details className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs">
      <summary className="cursor-pointer leading-relaxed font-medium">
        {report.revitVersion
          ? `Revit ${report.revitVersion}`
          : "Revit version unknown"}
        {" · "}
        {report.outcome === "preview"
          ? "Experimental preview"
          : "Not supported yet"}
      </summary>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
        <dt className="text-muted-foreground">With geometry</dt>
        <dd className="text-right tabular-nums">
          {report.displayedElements.toLocaleString()}
        </dd>
        <dt className="text-muted-foreground">Unresolved shapes</dt>
        <dd className="text-right tabular-nums">
          {report.omittedBoxElements.toLocaleString()} omitted
        </dd>
        <dt className="text-muted-foreground">Levels recovered</dt>
        <dd className="text-right tabular-nums">
          {report.levels.toLocaleString()}
        </dd>
      </dl>
      <p className="text-muted-foreground mt-3 leading-relaxed">
        These counts describe what we recovered, not how much of the original
        model is complete.
      </p>
      <ul className="mt-3 list-disc space-y-2 pl-4 leading-relaxed">
        {report.warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
      <p className="text-muted-foreground mt-3 border-t pt-2 text-[10px]">
        FormanHQ converter {report.engineVersion} · powered by the open-source
        rvt-rs reader
      </p>
    </details>
  );
}
