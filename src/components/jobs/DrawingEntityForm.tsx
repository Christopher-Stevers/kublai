"use client";
import { useState } from "react";
import type { DrawingSave, DrawingWorkspace } from "~/lib/drawing-workspace";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { notify } from "~/components/ui/app-dialogs";
import { drawingMarkupLinks } from "~/lib/drawing-links";
import { DrawingLinkEditor } from "./DrawingLinkEditor";

export const drawingFieldClass =
  "border-input bg-background w-full rounded-md border px-3 py-2 text-sm";
export function DrawingField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      {children}
    </label>
  );
}
export function DrawingEntityForm({
  value,
  onChange,
  onSubmit,
  pending,
  workspace,
  responseOnly = false,
  offline = false,
  onNavigate,
}: {
  value: DrawingSave;
  onChange: (value: DrawingSave) => void;
  onSubmit: () => void;
  pending: boolean;
  workspace: DrawingWorkspace;
  responseOnly?: boolean;
  offline?: boolean;
  onNavigate?: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const change = (patch: Record<string, unknown>) =>
    onChange({ ...value, data: { ...value.data, ...patch } } as DrawingSave);
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!pending && !uploading) onSubmit();
      }}
    >
      <fieldset disabled={pending || uploading} className="grid min-w-0 gap-3">
        {!responseOnly && ["markup", "view", "issue"].includes(value.kind) && (
          <DrawingField label="Visibility">
            <select
              className={drawingFieldClass}
              value={value.visibility}
              onChange={(event) =>
                onChange({
                  ...value,
                  visibility: event.target.value as DrawingSave["visibility"],
                })
              }
            >
              <option value="private">Private · only me</option>
              {(workspace.canManage || value.kind === "issue") && (
                <option disabled={offline} value="published">
                  Published · job team
                </option>
              )}
            </select>
          </DrawingField>
        )}
        {value.kind === "markup" && (
          <>
            <DrawingField
              label={
                value.data.type === "link" ? "Hyperlink name" : "Note / label"
              }
            >
              <textarea
                className={drawingFieldClass}
                rows={3}
                maxLength={4000}
                value={value.data.text ?? ""}
                onChange={(e) => change({ text: e.target.value })}
              />
            </DrawingField>
            <div className="grid grid-cols-2 gap-2">
              <DrawingField
                label={
                  value.data.type === "link" &&
                  value.data.linkAppearance === "highlight"
                    ? "Highlight color"
                    : "Line color"
                }
              >
                <input
                  className="h-10 w-full"
                  type="color"
                  value={
                    value.data.stroke === "none"
                      ? "#ef4444"
                      : value.data.stroke.slice(0, 7)
                  }
                  onChange={(e) =>
                    change({
                      stroke: e.target.value,
                      ...(value.data.type === "link" &&
                      value.data.linkAppearance === "highlight"
                        ? { fill: e.target.value }
                        : {}),
                    })
                  }
                />
              </DrawingField>
              {!(
                value.data.type === "link" &&
                value.data.linkAppearance === "highlight"
              ) && (
                <DrawingField label="Line width">
                  <Input
                    type="number"
                    min={0.1}
                    max={40}
                    step={0.1}
                    value={value.data.width}
                    onChange={(e) => change({ width: Number(e.target.value) })}
                  />
                </DrawingField>
              )}
            </div>
            {!(
              value.data.type === "link" &&
              value.data.linkAppearance === "highlight"
            ) && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(
                    value.data.fill && value.data.fill !== "none",
                  )}
                  onChange={(event) =>
                    change({
                      fill: event.target.checked ? value.data.stroke : "none",
                    })
                  }
                />
                Fill shape
              </label>
            )}
            {!(
              value.data.type === "link" &&
              value.data.linkAppearance === "highlight"
            ) &&
              value.data.fill &&
              value.data.fill !== "none" && (
                <DrawingField label="Fill color">
                  <input
                    type="color"
                    className="h-10 w-full"
                    value={value.data.fill.slice(0, 7)}
                    onChange={(event) => change({ fill: event.target.value })}
                  />
                </DrawingField>
              )}
            <DrawingField label="Opacity">
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.05}
                value={
                  value.data.opacity ??
                  (value.data.type === "link" &&
                  value.data.linkAppearance === "highlight"
                    ? 0.35
                    : 1)
                }
                onChange={(e) => change({ opacity: Number(e.target.value) })}
              />
            </DrawingField>
            {value.data.type === "link" && (
              <>
                <DrawingField label="Hyperlink appearance">
                  <select
                    className={drawingFieldClass}
                    value={value.data.linkAppearance ?? "box"}
                    onChange={(e) =>
                      change({
                        linkAppearance: e.target.value,
                        fill:
                          e.target.value === "highlight"
                            ? value.data.stroke
                            : "none",
                        opacity: e.target.value === "highlight" ? 0.35 : 1,
                      })
                    }
                  >
                    <option value="highlight">
                      Highlight · equipment tag stays visible
                    </option>
                    <option value="box">Outlined box with a label</option>
                  </select>
                </DrawingField>
                <DrawingLinkEditor
                  links={drawingMarkupLinks(value.data)}
                  onChange={(links) =>
                    change({ links, href: undefined, targetSheetId: undefined })
                  }
                  workspace={workspace}
                  offline={offline}
                  onUploading={setUploading}
                  onNavigate={onNavigate}
                />
              </>
            )}
            {["dimension", "area"].includes(value.data.type) && (
              <p className="text-muted-foreground text-xs">
                Measurements use this sheet’s calibration. Calibrate in Measure
                before recording quantities.
              </p>
            )}
          </>
        )}
        {value.kind === "issue" && (
          <>
            {!responseOnly && (
              <DrawingField
                label={
                  value.data.type === "rfi" ? "RFI subject" : "Issue title"
                }
              >
                <Input
                  required
                  maxLength={255}
                  value={value.data.title}
                  onChange={(e) => change({ title: e.target.value })}
                />
              </DrawingField>
            )}
            <DrawingField
              label={
                value.data.type === "rfi" ? "Question / response" : "Details"
              }
            >
              <textarea
                className={drawingFieldClass}
                rows={5}
                maxLength={12000}
                value={value.data.body}
                onChange={(e) => change({ body: e.target.value })}
              />
            </DrawingField>
            <DrawingField label="Status">
              <select
                className={drawingFieldClass}
                value={value.data.status}
                onChange={(e) => change({ status: e.target.value })}
              >
                {["open", "in_progress", "answered", "closed"].map((status) => (
                  <option key={status} value={status}>
                    {status.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </DrawingField>
            {!responseOnly && (
              <>
                <DrawingField label="Assigned to">
                  <select
                    className={drawingFieldClass}
                    value={value.data.assigneeId ?? ""}
                    onChange={(e) =>
                      change({ assigneeId: e.target.value || null })
                    }
                  >
                    <option value="">Unassigned</option>
                    {workspace.members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </DrawingField>
                <DrawingField label="Due date">
                  <Input
                    type="date"
                    value={value.data.dueDate ?? ""}
                    onChange={(e) =>
                      change({ dueDate: e.target.value || null })
                    }
                  />
                </DrawingField>
                <div className="grid gap-2">
                  <span className="text-sm font-medium">
                    Photos and references
                  </span>
                  {value.data.links.map((link, index) => (
                    <div
                      className="grid grid-cols-[1fr_auto] gap-2"
                      key={index}
                    >
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="truncate text-sm underline"
                      >
                        {link.label || "Open reference"}
                      </a>
                      <button
                        type="button"
                        className="text-sm"
                        onClick={() =>
                          change({
                            links: value.data.links.filter(
                              (_, i) => i !== index,
                            ),
                          })
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <label className="cursor-pointer rounded-md border p-2 text-center text-sm">
                    {uploading ? "Uploading…" : "Add photo or PDF"}
                    <input
                      type="file"
                      className="sr-only"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      disabled={
                        offline || uploading || value.data.links.length >= 20
                      }
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (!file) return;
                        setUploading(true);
                        void (async () => {
                          const response = await fetch(
                            `/api/drawings/attachments?sheetId=${encodeURIComponent(workspace.sheetId)}&name=${encodeURIComponent(file.name)}`,
                            {
                              method: "POST",
                              headers: { "Content-Type": file.type },
                              body: file,
                            },
                          );
                          const result = (await response.json()) as {
                            url?: string;
                            error?: string;
                          };
                          if (!response.ok || !result.url)
                            throw Error(
                              result.error ?? "Attachment upload failed",
                            );
                          change({
                            links: [
                              ...value.data.links,
                              { label: file.name, url: result.url },
                            ],
                          });
                        })()
                          .catch((e: unknown) =>
                            notify(
                              e instanceof Error ? e.message : "Upload failed",
                              "error",
                            ),
                          )
                          .finally(() => setUploading(false));
                      }}
                    />
                  </label>
                  <DrawingField label="Add a web reference">
                    <Input
                      type="url"
                      placeholder="https://… then press Enter"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const input = e.currentTarget;
                          if (input.value && input.checkValidity()) {
                            change({
                              links: [
                                ...value.data.links,
                                { label: input.value, url: input.value },
                              ],
                            });
                            input.value = "";
                          }
                        }
                      }}
                    />
                  </DrawingField>
                </div>
              </>
            )}
          </>
        )}
        {value.kind === "view" && (
          <DrawingField label="Saved view name">
            <Input
              required
              maxLength={255}
              value={value.data.name}
              onChange={(e) => change({ name: e.target.value })}
            />
          </DrawingField>
        )}
        {value.kind === "version" && (
          <>
            <DrawingField label="Revision label">
              <Input
                required
                maxLength={255}
                placeholder="e.g. Rev 3 · Issued for construction"
                value={value.data.label}
                onChange={(e) => change({ label: e.target.value })}
              />
            </DrawingField>
            <DrawingField label="New revision sheet">
              <select
                required
                className={drawingFieldClass}
                value={value.data.sourceSheetId}
                onChange={(e) => change({ sourceSheetId: e.target.value })}
              >
                <option value="">Choose an uploaded sheet</option>
                {workspace.jobSheets.map((sheet) => (
                  <option value={sheet.id} key={sheet.id}>
                    {sheet.name} · {sheet.sourceFilename}
                  </option>
                ))}
              </select>
            </DrawingField>
            <DrawingField label="Revision notes">
              <textarea
                className={drawingFieldClass}
                rows={3}
                value={value.data.description}
                onChange={(e) => change({ description: e.target.value })}
              />
            </DrawingField>
            <p className="text-muted-foreground text-xs">
              The chosen sheet becomes current. Earlier revisions and their
              markups remain available in History.
            </p>
          </>
        )}
        {value.kind === "review" && (
          <>
            <DrawingField label="Review decision">
              <select
                className={drawingFieldClass}
                value={value.data.status}
                onChange={(e) => change({ status: e.target.value })}
              >
                <option
                  disabled={Boolean(value.data.requestId)}
                  value="pending"
                >
                  Request review
                </option>
                <option value="approved">Approved</option>
                <option value="changes_requested">Changes requested</option>
              </select>
            </DrawingField>
            <DrawingField label="Reviewer">
              <select
                className={drawingFieldClass}
                disabled={Boolean(value.data.requestId)}
                value={value.data.reviewerId ?? ""}
                onChange={(e) => change({ reviewerId: e.target.value || null })}
              >
                <option value="">Executive / drawing manager</option>
                {workspace.members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </DrawingField>
            <DrawingField label="Review notes">
              <textarea
                className={drawingFieldClass}
                rows={4}
                value={value.data.body}
                onChange={(e) => change({ body: e.target.value })}
              />
            </DrawingField>
            <p className="text-muted-foreground text-xs">
              This records a decision about the exact revision being viewed.
            </p>
          </>
        )}
        {value.kind === "transmittal" && (
          <>
            <DrawingField label="Package title">
              <Input
                required
                maxLength={255}
                value={value.data.title}
                onChange={(e) => change({ title: e.target.value })}
              />
            </DrawingField>
            <DrawingField label="Recipients / distribution record">
              <Input
                maxLength={500}
                value={value.data.recipient}
                onChange={(e) => change({ recipient: e.target.value })}
              />
            </DrawingField>
            <DrawingField label="Cover note">
              <textarea
                className={drawingFieldClass}
                rows={3}
                value={value.data.body}
                onChange={(e) => change({ body: e.target.value })}
              />
            </DrawingField>
            <fieldset className="grid max-h-52 gap-2 overflow-y-auto rounded-md border p-3">
              <legend className="px-1 text-sm">Included sheets</legend>
              {workspace.jobSheets.map((sheet) => (
                <label className="flex gap-2 text-sm" key={sheet.id}>
                  <input
                    type="checkbox"
                    checked={value.data.sourceSheetIds.includes(sheet.id)}
                    onChange={(e) =>
                      change({
                        sourceSheetIds: e.target.checked
                          ? [...value.data.sourceSheetIds, sheet.id]
                          : value.data.sourceSheetIds.filter(
                              (id) => id !== sheet.id,
                            ),
                      })
                    }
                  />
                  {sheet.name}
                </label>
              ))}
            </fieldset>
            <p className="text-muted-foreground text-xs">
              Creates an immutable issue record. It does not send email;
              download the package to distribute it.
            </p>
          </>
        )}
        {offline && (
          <p className="text-muted-foreground text-xs">
            Private draft saved on this device. Reconnect to publish or attach
            photos.
          </p>
        )}
        <Button
          type="submit"
          disabled={
            pending || uploading || (offline && value.visibility !== "private")
          }
        >
          {pending ? "Saving…" : "Save"}
        </Button>
      </fieldset>
    </form>
  );
}
