"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "~/trpc/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Upload, ExternalLink, LoaderCircle } from "lucide-react";
import { uploadModel } from "~/lib/bim/client";
import {
  disciplines,
  MAX_MODEL_BYTES,
  type BimModel,
  type BimWorkspace,
  type BimIssue,
  type BimIssueData,
} from "~/lib/bim/types";
export const inputClass =
  "w-full min-h-11 rounded-md border bg-background px-3 py-2 text-sm";
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "The request failed. Try again.";
export function UploadModelDialog({
  workspace,
  revision,
  onClose,
  onUploaded,
}: {
  workspace: BimWorkspace;
  revision: BimModel | null;
  onClose: () => void;
  onUploaded: (m: BimModel) => void;
}) {
  const [file, setFile] = useState<File | null>(null),
    [name, setName] = useState(revision?.name ?? ""),
    [discipline, setDiscipline] = useState<BimModel["discipline"]>(
      revision?.discipline ?? "coordination",
    ),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const submit = async () => {
    if (!file) return;
    if (file.size > MAX_MODEL_BYTES) {
      setError(
        "Models can be up to 250 MB. Export separate floors or trades for larger files.",
      );
      return;
    }
    setBusy(true);
    setError("");
    abort.current = new AbortController();
    try {
      const model = await uploadModel(
        file,
        {
          jobId: workspace.job.id,
          name: name.trim() || file.name.replace(/\.(rvt|ifc)$/i, ""),
          discipline,
          ...(revision
            ? { seriesId: revision.seriesId, expectedModelId: revision.id }
            : {}),
        },
        setProgress,
        abort.current.signal,
      );
      onUploaded(model);
      onClose();
    } catch (e) {
      if (!abort.current.signal.aborted) setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          abort.current?.abort();
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {revision ? "Upload a new revision" : "Add a construction model"}
          </DialogTitle>
          <DialogDescription>
            {revision
              ? "Earlier revisions and their saved viewpoints remain available."
              : "Upload a Revit (.rvt) file or an IFC export. Up to 250 MB per model."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center">
            <Upload className="text-primary size-7" />
            <span className="text-sm font-medium">
              {file?.name ?? "Choose Revit or IFC file"}
            </span>
            <span className="text-muted-foreground text-xs">
              {file
                ? `${(file.size / 1024 / 1024).toFixed(1)} MB`
                : "Separate trade models can be viewed together."}
            </span>
            <input
              className="max-w-full text-sm"
              type="file"
              accept=".rvt,.ifc"
              required
              disabled={busy}
              aria-label="Model file"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f && !revision)
                  setName(f.name.replace(/\.(rvt|ifc)$/i, ""));
              }}
            />
          </label>
          <label className="block space-y-1 text-sm">
            Model name
            <input
              className={inputClass}
              required
              maxLength={200}
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block space-y-1 text-sm">
            Discipline
            <select
              className={inputClass}
              value={discipline}
              disabled={busy}
              onChange={(e) =>
                setDiscipline(e.target.value as BimModel["discipline"])
              }
            >
              {disciplines.map((d) => (
                <option key={d} value={d}>
                  {d[0]!.toUpperCase() + d.slice(1)}
                </option>
              ))}
            </select>
          </label>
          {file?.name.toLowerCase().endsWith(".rvt") && (
            <p className="bg-muted text-muted-foreground rounded-md p-3 text-sm">
              {workspace.conversionAvailable
                ? "After upload, choose Prepare local preview. FormanHQ detects the Revit version and reads supported geometry on this server. No Autodesk account is needed."
                : "You can store this file now. The local Revit converter must be available before it can open in 3D."}{" "}
              Native conversion is experimental. Some shapes may be missing;
              measurements, linked models and shared coordinates are not yet
              verified.
            </p>
          )}
          {busy && (
            <div role="status" className="space-y-2 text-sm">
              <progress className="h-2 w-full" max={100} value={progress} />
              <p>Uploading model · {progress}%</p>
            </div>
          )}
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                abort.current?.abort();
                onClose();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !file}>
              {busy ? (
                <LoaderCircle className="mr-2 size-4 animate-spin" />
              ) : (
                <Upload className="mr-2 size-4" />
              )}
              Upload model
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function AutodeskDialog({
  workspace,
  onClose,
  onConnected,
}: {
  workspace: BimWorkspace;
  onClose: () => void;
  onConnected: () => void;
}) {
  const [id, setId] = useState(""),
    [secret, setSecret] = useState("");
  const connect = api.models.connectAutodesk.useMutation({
    onSuccess: () => {
      setSecret("");
      onConnected();
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Connect Autodesk</DialogTitle>
          <DialogDescription>
            One connection for your company. Your crew keeps using its FormanHQ
            sign-in.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm leading-relaxed">
          Autodesk Platform Services (APS) prepares native Revit files for this
          viewer. The <strong>client ID</strong> identifies your company’s app;
          the <strong>client secret</strong> is its private access key.
        </p>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>
            Open the Autodesk developer portal and set up your company’s
            developer hub and APS access.
          </li>
          <li>
            Create a server-to-server app for FormanHQ with Data Management and
            Model Derivative API access.
          </li>
          <li>Copy its client ID and client secret into the fields below.</li>
        </ol>
        <a
          className="text-primary inline-flex items-center gap-2 text-sm underline"
          href="https://aps.autodesk.com/myapps"
          target="_blank"
          rel="noreferrer"
        >
          Open Autodesk developer portal
          <ExternalLink className="size-4" />
        </a>
        <p className="text-muted-foreground text-sm">
          When you choose Convert, the model is sent to Autodesk. Its service
          has separate{" "}
          <a
            className="underline"
            target="_blank"
            rel="noreferrer"
            href="https://aps.autodesk.com/pricing"
          >
            usage pricing
          </a>
          . IFC files open directly without this connection.
        </p>
        {workspace.canConfigureAutodesk ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              connect.mutate({
                jobId: workspace.job.id,
                credentials: { clientId: id, clientSecret: secret },
              });
            }}
          >
            <label className="block space-y-1 text-sm">
              Client ID
              <input
                className={inputClass}
                autoComplete="off"
                value={id}
                onChange={(e) => setId(e.target.value)}
                required
                minLength={8}
                maxLength={200}
              />
            </label>
            <label className="block space-y-1 text-sm">
              Client secret
              <input
                className={inputClass}
                type="password"
                autoComplete="new-password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                required
                minLength={8}
                maxLength={500}
              />
            </label>
            <p className="text-muted-foreground text-xs">
              Stored encrypted on the server. Never shown to other members.
            </p>
            {connect.error && (
              <p role="alert" className="text-destructive text-sm">
                {connect.error.message}
              </p>
            )}
            <Button className="w-full" disabled={connect.isPending}>
              {connect.isPending
                ? "Checking connection…"
                : "Verify and save connection"}
            </Button>
          </form>
        ) : (
          <p className="bg-muted rounded-md p-3 text-sm">
            A company administrator with model upload permission can complete
            this setup.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
export function IssueDialog({
  workspace,
  issue,
  draft,
  onClose,
  onSaved,
}: {
  workspace: BimWorkspace;
  issue: BimIssue | null;
  draft: BimIssueData;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [data, setData] = useState(draft),
    [comment, setComment] = useState("");
  const id = useRef(issue?.id ?? crypto.randomUUID());
  const save = api.models.saveIssue.useMutation({
      onSuccess: () => {
        onSaved();
        onClose();
      },
    }),
    add = api.models.comment.useMutation({
      onSuccess: () => {
        setComment("");
        onSaved();
      },
    });
  const canEdit =
      !issue || issue.authorId === workspace.userId || workspace.canUpload,
    canStatus = canEdit || issue?.assigneeId === workspace.userId;
  const change = <K extends keyof BimIssueData>(
    key: K,
    value: BimIssueData[K],
  ) => setData((d) => ({ ...d, [key]: value }));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {issue ? "Model issue" : "Create a model issue"}
          </DialogTitle>
          <DialogDescription>
            The element, model revisions and camera view are attached to this
            issue.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({
              jobId: workspace.job.id,
              id: id.current,
              expectedRevision: issue?.revision ?? 0,
              data,
            });
          }}
        >
          <label className="block space-y-1 text-sm">
            Title
            <input
              className={inputClass}
              value={data.title}
              required
              maxLength={200}
              disabled={!canEdit}
              onChange={(e) => change("title", e.target.value)}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-sm">
              Type
              <select
                className={inputClass}
                value={data.kind}
                disabled={!canEdit}
                onChange={(e) =>
                  change("kind", e.target.value as BimIssueData["kind"])
                }
              >
                {["coordination", "rfi", "punch", "safety"].map((v) => (
                  <option value={v} key={v}>
                    {v.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              Priority
              <select
                className={inputClass}
                value={data.priority}
                disabled={!canEdit}
                onChange={(e) =>
                  change("priority", e.target.value as BimIssueData["priority"])
                }
              >
                {["low", "normal", "high", "critical"].map((v) => (
                  <option value={v} key={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block space-y-1 text-sm">
            Description
            <textarea
              className={inputClass}
              rows={3}
              maxLength={5000}
              value={data.description}
              disabled={!canEdit}
              onChange={(e) => change("description", e.target.value)}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-sm">
              Assigned to
              <select
                className={inputClass}
                value={data.assigneeId ?? ""}
                disabled={!canEdit}
                onChange={(e) => change("assigneeId", e.target.value || null)}
              >
                <option value="">Unassigned</option>
                {workspace.members.map((m) => (
                  <option value={m.id} key={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              Due date
              <input
                className={inputClass}
                type="date"
                disabled={!canEdit}
                value={data.dueDate ?? ""}
                onChange={(e) => change("dueDate", e.target.value || null)}
              />
            </label>
          </div>
          <label className="block space-y-1 text-sm">
            Status
            <select
              className={inputClass}
              value={data.status}
              disabled={!canStatus}
              onChange={(e) =>
                change("status", e.target.value as BimIssueData["status"])
              }
            >
              {["open", "in_progress", "resolved", "closed"].map((v) => (
                <option value={v} key={v}>
                  {v.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          {save.error && (
            <p role="alert" className="text-destructive text-sm">
              {save.error.message}
            </p>
          )}
          <Button
            type="submit"
            disabled={!canStatus || save.isPending}
            className="w-full"
          >
            {save.isPending ? "Saving…" : "Save issue"}
          </Button>
        </form>
        {issue && (
          <section className="space-y-3 border-t pt-4">
            <h3 className="text-sm font-semibold">Comments</h3>
            {issue.comments.map((c) => (
              <div key={c.id} className="text-sm">
                <p className="text-muted-foreground text-xs">
                  {c.authorName} · {new Date(c.createdAt).toLocaleString()}
                </p>
                <p className="break-words whitespace-pre-wrap">{c.text}</p>
              </div>
            ))}
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                add.mutate({
                  jobId: workspace.job.id,
                  id: issue.id,
                  text: comment,
                });
              }}
            >
              <input
                className={inputClass}
                value={comment}
                aria-label="Comment"
                placeholder="Add a comment…"
                maxLength={5000}
                required
                onChange={(e) => setComment(e.target.value)}
              />
              <Button disabled={add.isPending || !comment.trim()}>Send</Button>
            </form>
            {add.error && (
              <p role="alert" className="text-destructive text-sm">
                {add.error.message}
              </p>
            )}
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
