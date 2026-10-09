"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "~/trpc/react";
import type {
  DrawingMarkupLink,
  DrawingWorkspace,
} from "~/lib/drawing-workspace";
import { drawingMarkupLinkSchema } from "~/lib/drawing-workspace";
import {
  MAX_DRAWING_LINKS,
  type DrawingLinkTargetKind,
} from "~/lib/drawing-links";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

const field =
  "border-input bg-background w-full rounded-md border px-3 py-2 text-sm";
export function DrawingLinkEditor({
  links,
  onChange,
  workspace,
  offline,
  onUploading,
}: {
  links: DrawingMarkupLink[];
  onChange: (links: DrawingMarkupLink[]) => void;
  workspace: DrawingWorkspace;
  offline: boolean;
  onUploading: (busy: boolean) => void;
}) {
  const [kind, setKind] = useState<DrawingLinkTargetKind | "url">("url");
  const [jobId, setJobId] = useState(workspace.jobId);
  const [query, setQuery] = useState("");
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const upload = useRef<AbortController | null>(null);
  useEffect(() => () => upload.current?.abort(), [workspace.sheetId]);
  const targets = api.drawingsWorkspace.linkTargets.useQuery(
    {
      sheetId: workspace.sheetId,
      kind: kind === "url" ? "job" : kind,
      jobId,
      query,
    },
    { enabled: !offline && kind !== "url", retry: 1 },
  );
  const full = links.length >= MAX_DRAWING_LINKS;
  const add = (link: DrawingMarkupLink) => {
    if (full) return false;
    const parsed = drawingMarkupLinkSchema.safeParse(link);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Choose a destination.");
      return false;
    }
    if (
      links.some(
        (item) =>
          item.url === parsed.data.url &&
          item.targetSheetId === parsed.data.targetSheetId,
      )
    ) {
      setError("This destination is already in the hyperlink.");
      return false;
    }
    onChange([...links, parsed.data]);
    setError(null);
    return true;
  };
  const addAddress = () => {
    if (
      add({ label: label.trim() || url.trim().slice(0, 255), url: url.trim() })
    ) {
      setUrl("");
      setLabel("");
    }
  };
  return (
    <section aria-label="Hyperlink destinations" className="grid min-w-0 gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Destinations</h3>
        <span className="text-muted-foreground text-xs">
          {links.length} / {MAX_DRAWING_LINKS}
        </span>
      </div>
      {links.map((link, index) => (
        <div key={index} className="grid min-w-0 gap-1 border-b pb-2">
          <div className="flex items-center gap-2">
            <Input
              aria-label={`Link ${index + 1} name`}
              maxLength={255}
              value={link.label}
              onChange={(event) =>
                onChange(
                  links.map((item, i) =>
                    i === index ? { ...item, label: event.target.value } : item,
                  ),
                )
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Remove link ${index + 1}`}
              onClick={() => onChange(links.filter((_, i) => i !== index))}
            >
              Remove
            </Button>
          </div>
          <p
            className="text-muted-foreground truncate text-xs"
            title={link.url}
          >
            {link.url ??
              workspace.jobSheets.find(
                (sheet) => sheet.id === link.targetSheetId,
              )?.name ??
              "Drawing sheet"}
          </p>
        </div>
      ))}
      <label className="grid gap-1 text-sm font-medium">
        Add a destination
        <select
          className={field}
          value={kind}
          disabled={full}
          onChange={(event) => {
            setKind(event.target.value as typeof kind);
            setQuery("");
            setError(null);
          }}
        >
          <option value="url">Web, email, phone or app address</option>
          <option value="sheet">Drawing sheet</option>
          <option value="document">Document</option>
          <option value="photo">Photo</option>
          <option value="chat">Chat</option>
          <option value="materialList">Material list / tool request</option>
          <option value="job">Job page</option>
        </select>
      </label>
      {kind === "url" ? (
        <>
          <label className="grid gap-1 text-sm">
            Address
            <Input
              value={url}
              maxLength={2048}
              placeholder="https://… or /dashboard/…"
              disabled={full}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addAddress();
                }
              }}
            />
          </label>
          <label className="grid gap-1 text-sm">
            Link name (optional)
            <Input
              value={label}
              maxLength={255}
              placeholder="Equipment manual"
              disabled={full}
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={full || !url.trim()}
            onClick={addAddress}
          >
            Add link
          </Button>
        </>
      ) : (
        <>
          {!offline && (
            <label className="grid gap-1 text-sm">
              Job
              <select
                className={field}
                value={jobId}
                onChange={(event) => {
                  setJobId(event.target.value);
                  setQuery("");
                }}
              >
                {(
                  targets.data?.jobs ?? [
                    { id: workspace.jobId, name: "This job" },
                  ]
                ).map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Input
            aria-label="Find destination"
            maxLength={100}
            placeholder="Find a destination…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="grid max-h-56 gap-1 overflow-y-auto">
            {offline && kind === "sheet"
              ? workspace.jobSheets
                  .filter((sheet) =>
                    sheet.name.toLowerCase().includes(query.toLowerCase()),
                  )
                  .map((sheet) => (
                    <Button
                      key={sheet.id}
                      type="button"
                      variant="outline"
                      className="justify-start"
                      disabled={full}
                      onClick={() =>
                        add({ label: sheet.name, targetSheetId: sheet.id })
                      }
                    >
                      {sheet.name}
                    </Button>
                  ))
              : !offline &&
                targets.data?.targets.map((target) => (
                  <button
                    key={target.key}
                    type="button"
                    className="hover:bg-muted rounded-md border p-2 text-left text-sm disabled:opacity-50"
                    disabled={full}
                    onClick={() =>
                      add({
                        label: target.label.slice(0, 255),
                        url: target.url,
                        targetSheetId: target.targetSheetId,
                      })
                    }
                  >
                    <span className="block">{target.label}</span>
                    {target.description && (
                      <span className="text-muted-foreground text-xs">
                        {target.description}
                      </span>
                    )}
                  </button>
                ))}
          </div>
          {offline && kind !== "sheet" && (
            <p className="text-muted-foreground text-xs">
              Reconnect to browse job resources. You can still paste an address.
            </p>
          )}
          {targets.isFetching && !offline && (
            <p role="status" className="text-sm">
              Finding destinations…
            </p>
          )}
          {targets.error && !offline && (
            <p role="alert" className="text-sm text-red-600">
              {targets.error.message}
            </p>
          )}
          {!offline && targets.data?.targets.length === 0 && (
            <p className="text-muted-foreground text-xs">
              No matching destinations.
            </p>
          )}
        </>
      )}
      <label className="cursor-pointer rounded-md border p-2 text-center text-sm">
        Upload a photo or PDF
        <input
          type="file"
          className="sr-only"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          disabled={offline || full}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            const controller = new AbortController();
            upload.current = controller;
            onUploading(true);
            setError(null);
            void fetch(
              `/api/drawings/attachments?sheetId=${encodeURIComponent(workspace.sheetId)}&name=${encodeURIComponent(file.name)}`,
              {
                method: "POST",
                headers: { "Content-Type": file.type },
                body: file,
                signal: controller.signal,
              },
            )
              .then(async (response) => {
                const result = (await response.json()) as {
                  url?: string;
                  error?: string;
                };
                if (!response.ok || !result.url)
                  throw Error(result.error ?? "Upload failed.");
                if (!controller.signal.aborted)
                  add({ label: file.name.slice(0, 255), url: result.url });
              })
              .catch((reason: unknown) => {
                if (!controller.signal.aborted)
                  setError(
                    reason instanceof Error ? reason.message : "Upload failed.",
                  );
              })
              .finally(() => {
                if (!controller.signal.aborted) onUploading(false);
              });
          }}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <p className="text-muted-foreground text-xs">
        One destination opens directly. Multiple destinations show a list when
        the hyperlink is tapped.
      </p>
    </section>
  );
}
