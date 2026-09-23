import { createHash, randomUUID } from "node:crypto";
import type { PatchOperation } from "replicache";

type Row = Extract<PatchOperation, { op: "put" }>;
type View = {
  id: string;
  scope: string;
  revision: string;
  rows: Map<string, { row: Row; hash: string }>;
  bytes: number;
  expires: number;
};

/** A missing/expired view always produces a self-healing full snapshot. */
export class ReplicacheViews {
  private views = new Map<string, View>();
  constructor(
    private maxBytes = 48 * 1024 * 1024,
    private ttl = 30 * 60_000,
  ) {}

  private prune() {
    let bytes = 0;
    for (const [id, view] of this.views) {
      if (view.expires <= Date.now()) this.views.delete(id);
      else bytes += view.bytes;
    }
    for (const [id, view] of this.views) {
      if (bytes <= this.maxBytes && this.views.size <= 64) break;
      this.views.delete(id);
      bytes -= view.bytes;
    }
  }

  find(scope: string, revision: string) {
    this.prune();
    return [...this.views.values()].find(
      (v) => v.scope === scope && v.revision === revision,
    );
  }

  create(scope: string, revision: string, patch: PatchOperation[]): View {
    const rows: View["rows"] = new Map();
    let bytes = 0;
    for (const row of patch) {
      if (row.op !== "put") continue;
      const json = JSON.stringify(row.value);
      bytes += Buffer.byteLength(json) + row.key.length * 2 + 128;
      rows.set(row.key, {
        row,
        hash: createHash("sha256").update(json).digest("hex"),
      });
    }
    return {
      id: randomUUID(),
      scope,
      revision,
      rows,
      bytes,
      expires: Date.now() + this.ttl,
    };
  }

  remember(view: View) {
    this.views.delete(view.id);
    this.views.set(view.id, view);
    this.prune();
  }

  diff(view: View, cookie: unknown): PatchOperation[] {
    this.prune();
    const id =
      cookie && typeof cookie === "object" && "cvr" in cookie
        ? cookie.cvr
        : null;
    const prior = typeof id === "string" ? this.views.get(id) : undefined;
    if (!prior || prior.scope !== view.scope) {
      return [{ op: "clear" }, ...[...view.rows.values()].map((r) => r.row)];
    }
    const patch: PatchOperation[] = [];
    for (const key of prior.rows.keys())
      if (!view.rows.has(key)) patch.push({ op: "del", key });
    for (const [key, value] of view.rows) {
      if (prior.rows.get(key)?.hash !== value.hash) patch.push(value.row);
    }
    return patch;
  }
}
