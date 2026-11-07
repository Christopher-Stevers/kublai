"use client";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import type { DrawingMarkup, DrawingMarkupLink } from "~/lib/drawing-workspace";
import { api } from "~/trpc/react";

type Render = (link: DrawingMarkupLink, content: ReactNode, key: string, className?: string) => ReactNode;
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
/** "STEAM CONDENSATE SURGE TANK SCHEDULE" → "Steam condensate surge tank". */
export function equipmentKind(title: string) {
  const kind = title
    .replace(/\b(?:EQUIPMENT\s+)?SCHEDULES?\b.*$/i, "")
    .replace(/[^A-Z0-9&/ -]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return kind.length >= 3 && !/^(?:MECHANICAL|PLUMBING|ELECTRICAL|HVAC|GENERAL)$/i.test(kind) ? sentence(kind) : "";
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">{title}</h3>
      <div className="grid gap-1.5">{children}</div>
    </section>
  );
}

/**
 * Every current place an equipment tag appears in the job: its schedule rows,
 * drawings in every set and documents. Saved links remain available offline.
 */
export function EquipmentTagDestinations({
  sheetId,
  markup,
  saved,
  online,
  renderLink,
}: {
  sheetId: string;
  markup: DrawingMarkup;
  /** The hyperlink's saved destinations, already excluding this occurrence. */
  saved: DrawingMarkupLink[];
  online: boolean;
  renderLink: Render;
}) {
  const tag = markup.equipmentTag!;
  const xs = markup.points.map((p) => p.x),
    ys = markup.points.map((p) => p.y);
  const exclude = xs.length
    ? { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) }
    : undefined;
  const query = api.drawingsWorkspace.equipmentTag.useQuery(
    { sheetId, tag, exclude },
    { enabled: online, staleTime: 60_000, retry: 1 },
  );
  const data = query.data;
  // Links the scan saved for this tag are superseded by the live search;
  // anything added by hand (photos, chats, lists) is kept.
  const others = data ? saved.filter((link) => !link.label?.startsWith(`${tag} — `)) : saved;
  const kind = data?.schedules.map((s) => equipmentKind(s.title)).find(Boolean);
  const count = data ? data.schedules.length + data.drawings.length + data.documents.length : 0;
  const button = "h-auto min-h-11 w-full justify-start text-left whitespace-normal";
  return (
    <div className="grid max-h-[65vh] gap-4 overflow-y-auto pr-1">
      {kind && <p className="text-sm font-medium">{kind}</p>}
      {!online && <p className="text-muted-foreground text-sm">Offline: showing the links saved with this tag.</p>}
      {online && query.isLoading && (
        <p role="status" className="text-muted-foreground text-sm">
          Finding every place {tag} appears in this job…
        </p>
      )}
      {query.error && (
        <p role="alert" className="text-destructive text-sm">
          Could not search the job ({query.error.message}). Showing saved links.
        </p>
      )}
      {data && data.schedules.length > 0 && (
        <Section title="Schedule">
          {data.schedules.map((entry, index) =>
            renderLink(
              { label: `${tag} — ${entry.source}`, url: entry.url },
              <span className="grid gap-0.5">
                <span className="font-medium">
                  {entry.title || "Schedule"} <span className="text-muted-foreground font-normal">· {entry.source}</span>
                </span>
                {entry.cells.length > 0 && (
                  <span className="text-muted-foreground line-clamp-2 text-xs">{entry.cells.slice(0, 8).join(" · ")}</span>
                )}
              </span>,
              `schedule-${index}`,
              button,
            ),
          )}
        </Section>
      )}
      {data && data.drawings.length > 0 && (
        <Section title={`Drawings (${data.drawings.length})`}>
          {data.drawings.map((drawing) => (
            <div key={drawing.sheetId} className="flex items-stretch gap-1.5">
              {renderLink(
                drawing.links[0]!,
                <span className="grid gap-0.5">
                  <span className="font-medium">{drawing.here ? `${drawing.name} (this sheet)` : drawing.name}</span>
                  {(drawing.setName || drawing.links.length > 1) && (
                    <span className="text-muted-foreground text-xs">
                      {[drawing.setName, drawing.links.length > 1 ? `${drawing.links.length} places` : ""].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </span>,
                `${drawing.sheetId}-0`,
                `${button} min-w-0 flex-1`,
              )}
              {drawing.links.slice(1, 6).map((link, index) =>
                renderLink(link, String(index + 2), `${drawing.sheetId}-${index + 1}`, "h-auto min-h-11 w-10 shrink-0 px-0"),
              )}
            </div>
          ))}
        </Section>
      )}
      {data && data.documents.length > 0 && (
        <Section title={`Documents (${data.documents.length})`}>
          {data.documents.map((doc) =>
            renderLink(
              { label: `${tag} — ${doc.name}`, url: doc.url },
              <span className="grid gap-0.5">
                <span className="font-medium">{doc.name}</span>
                {doc.pages.length > 0 && (
                  <span className="text-muted-foreground text-xs">
                    {doc.pages.length === 1 ? "Page" : "Pages"} {doc.pages.slice(0, 8).join(", ")}
                    {doc.pages.length > 8 ? "…" : ""}
                  </span>
                )}
              </span>,
              `doc-${doc.documentId}`,
              button,
            ),
          )}
        </Section>
      )}
      {data && !count && (
        <p className="text-muted-foreground text-sm">{tag} does not appear anywhere else in this job’s drawings or documents.</p>
      )}
      {others.length > 0 && (
        <Section title={data ? "Other links" : "Saved links"}>
          {others.map((link, index) => renderLink(link, link.label, `saved-${index}`, button))}
        </Section>
      )}
      {data && (data.pending > 0 || data.warnings.length > 0) && (
        <div className="text-muted-foreground space-y-1 text-xs">
          {data.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
          {data.pending > 0 && (
            <p className="flex items-center gap-2">
              Still reading {data.pending} file{data.pending === 1 ? "" : "s"}.
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void query.refetch()}>
                Search again
              </Button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
