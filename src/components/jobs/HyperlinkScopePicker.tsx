"use client";
import { useEffect, useState } from "react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import type { HyperlinkScope, HyperlinkTargets } from "~/lib/hyperlink-scope";

export function HyperlinkScopePicker({
  sheetId,
  value,
  onChange,
  disabled,
}: {
  sheetId: string;
  value: HyperlinkScope;
  onChange: (next: HyperlinkScope) => void;
  disabled: boolean;
}) {
  const fetchTargets =
    api.useUtils().drawingsWorkspace.autoHyperlinkTargets.fetch;
  const [targets, setTargets] = useState<HyperlinkTargets | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState("");
  useEffect(() => {
    if (value.scope !== "custom") return;
    let cancelled = false;
    setError("");
    void fetchTargets({ sheetId }, { staleTime: 0 })
      .then((data) => {
        if (!cancelled) setTargets(data);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load search sources.");
      });
    return () => {
      cancelled = true;
    };
  }, [sheetId, value.scope, fetchTargets, retry]);
  const change = (
    kind: "drawingIds" | "documentIds",
    ids: string[],
    checked: boolean,
  ) => {
    const next = new Set(value[kind]);
    for (const id of ids) {
      if (checked) next.add(id);
      else next.delete(id);
    }
    onChange({ ...value, [kind]: [...next] });
  };
  const query = search.trim().toLowerCase();
  const matches = (name: string) =>
    !query || name.toLowerCase().includes(query);
  const group = (
    name: string,
    kind: "drawingIds" | "documentIds",
    items: { id: string; name: string }[],
    key: string,
  ) => {
    const visible = matches(name)
      ? items
      : items.filter((i) => matches(i.name));
    if (!visible.length) return null;
    const count = items.filter((i) => value[kind].includes(i.id)).length;
    return (
      <details
        key={key}
        className="border-b py-2"
        open={query ? true : undefined}
      >
        <summary className="cursor-pointer py-2 text-sm">
          {name}{" "}
          <span className="text-muted-foreground">
            ({count}/{items.length})
          </span>
        </summary>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            disabled={disabled}
            checked={count === items.length}
            ref={(el) => {
              if (el) el.indeterminate = count > 0 && count < items.length;
            }}
            onChange={(e) =>
              change(
                kind,
                items.map((i) => i.id),
                e.target.checked,
              )
            }
          />
          Select all in {name}
        </label>
        {visible.map((item) => (
          <label
            key={item.id}
            className="flex min-h-11 items-center gap-3 pl-3 text-sm"
          >
            <input
              type="checkbox"
              disabled={disabled}
              checked={value[kind].includes(item.id)}
              onChange={(e) => change(kind, [item.id], e.target.checked)}
            />
            <span className="min-w-0 break-words">{item.name}</span>
          </label>
        ))}
      </details>
    );
  };
  const folderPath = (id: string | null) => {
    const names: string[] = [],
      seen = new Set<string>();
    while (id && !seen.has(id)) {
      seen.add(id);
      const f = targets?.folders.find((f) => f.id === id);
      if (!f) break;
      names.unshift(f.name);
      id = f.parentId;
    }
    return names.join(" / ") || "Unfiled documents";
  };
  const inFolder = (doc: HyperlinkTargets["documents"][number], id: string) => {
    let parent = doc.folderId;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      if (parent === id) return true;
      seen.add(parent);
      parent = targets?.folders.find((f) => f.id === parent)?.parentId ?? null;
    }
    return false;
  };
  return (
    <div className="min-w-0 space-y-2">
      <label className="block text-sm">
        Search scope
        <select
          aria-label="Hyperlink search scope"
          className="bg-background mt-1 h-11 w-full rounded border px-2"
          value={value.scope}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              ...value,
              scope: e.target.value as HyperlinkScope["scope"],
            })
          }
        >
          <option value="job">All drawings + job documents</option>
          <option value="set">This drawing set + job documents</option>
          <option value="drawings">Drawings only</option>
          <option value="documents">Job documents only</option>
          <option value="custom">Choose sets, sheets, folders and files</option>
        </select>
      </label>
      {value.scope === "custom" && (
        <div className="space-y-2 rounded border p-3">
          <p className="text-sm">
            {value.drawingIds.length} sheets · {value.documentIds.length}{" "}
            documents selected
          </p>
          <Input
            aria-label="Search hyperlink sources"
            placeholder="Find a set, sheet, folder or file"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {error ? (
            <div role="alert">
              {error}{" "}
              <Button
                variant="outline"
                disabled={disabled}
                onClick={() => setRetry((n) => n + 1)}
              >
                Retry
              </Button>
            </div>
          ) : !targets ? (
            <p role="status">Loading search sources…</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() =>
                    onChange({
                      ...value,
                      drawingIds: targets.drawings.map((d) => d.id),
                      documentIds: targets.documents.map((d) => d.id),
                    })
                  }
                >
                  Select all sources
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() =>
                    onChange({ ...value, drawingIds: [], documentIds: [] })
                  }
                >
                  Clear sources
                </Button>
              </div>
              <div className="max-h-64 overflow-y-auto overscroll-contain">
                <p className="font-medium">Drawings</p>
                {[...new Set(targets.drawings.map((d) => d.setId))].map((id) =>
                  group(
                    targets.drawings.find((d) => d.setId === id)!.setName,
                    "drawingIds",
                    targets.drawings.filter((d) => d.setId === id),
                    id,
                  ),
                )}
                <p className="mt-3 font-medium">Documents</p>
                <p className="text-muted-foreground text-xs">
                  Folder selection includes its subfolders.
                </p>
                {targets.folders.map((f) =>
                  group(
                    folderPath(f.id),
                    "documentIds",
                    targets.documents.filter((d) => inFolder(d, f.id)),
                    f.id,
                  ),
                )}
                {group(
                  "Unfiled documents",
                  "documentIds",
                  targets.documents.filter(
                    (d) =>
                      !d.folderId ||
                      !targets.folders.some((f) => f.id === d.folderId),
                  ),
                  "unfiled",
                )}
                {!targets.drawings.length && !targets.documents.length && (
                  <p className="py-2 text-sm">
                    No searchable sources available.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
