"use client";
import { useState } from "react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { SupplierPartsDialog } from "./SupplierPartsDialog";
import { useOnlineStatus } from "~/hooks/use-online-status";

export function SupplierPriceBooksDialog({
  supplierId,
  onClose,
}: {
  supplierId: string;
  onClose: () => void;
}) {
  const online = useOnlineStatus();
  const utils = api.useUtils();
  const [limit, setLimit] = useState(50);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [all, setAll] = useState(false);
  const [standardEditor, setStandardEditor] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [price, setPrice] = useState("");
  const [status, setStatus] = useState<"none" | "estimated" | "confirmed">(
    "none",
  );
  const [error, setError] = useState<string | null>(null);
  const list = api.supplierPriceBooks.list.useQuery(
    { supplierId },
    { enabled: online },
  );
  const detail = api.supplierPriceBooks.get.useQuery(
    { supplierId, bookId: selected },
    { enabled: online },
  );
  const refresh = async () => {
    await Promise.all([
      utils.supplierPriceBooks.invalidate(),
      utils.jobPricing.invalidate(),
      utils.materialList.previewOrders.invalidate(),
    ]);
  };
  const create = api.supplierPriceBooks.create.useMutation({
    onSuccess: async (b) => {
      setSelected(b.id);
      setAll(true);
      setName("");
      await refresh();
    },
    onError: (e) => setError(e.message),
  });
  const save = api.supplierPriceBooks.saveEntry.useMutation({
    onSuccess: async () => {
      setEditing(null);
      await refresh();
    },
    onError: (e) => setError(e.message),
  });
  const data = detail.data;
  const rows = (data?.rows ?? []).filter(
    (r) =>
      (!selected || all || r.included) &&
      `${r.name} ${r.sku ?? ""}`.toLowerCase().includes(search.toLowerCase()),
  );
  const saveRow = (id: string, included: boolean) => {
    if (!selected || !data?.book) return;
    const amount = price.trim() === "" ? null : Number(price);
    if (
      included &&
      amount !== null &&
      (!Number.isFinite(amount) || amount < 0)
    ) {
      setError("Enter a valid non-negative price.");
      return;
    }
    setError(null);
    save.mutate({
      bookId: selected,
      revision: data.book.revision,
      supplierPartId: id,
      included,
      unitCost: included ? amount : null,
      priceStatus: included ? status : "none",
    });
  };
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {data?.supplier.name ?? "Supplier"} · Price Books
            </DialogTitle>
          </DialogHeader>
          {!online ? (
            <p>Connect to view and edit price books.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={selected === null ? "default" : "outline"}
                  onClick={() => {
                    setSelected(null);
                    setEditing(null);
                  }}
                >
                  Standard
                </Button>
                {list.data?.books.map((b) => (
                  <Button
                    key={b.id}
                    variant={selected === b.id ? "default" : "outline"}
                    onClick={() => {
                      setSelected(b.id);
                      setEditing(null);
                      setAll(false);
                    }}
                  >
                    {b.name} ({b.count})
                  </Button>
                ))}
              </div>
              {list.data?.canManage && (
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setError(null);
                    create.mutate({ supplierId, name });
                  }}
                >
                  <Input
                    aria-label="New price book name"
                    placeholder="New price book name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={!name.trim() || create.isPending}
                  >
                    Create book
                  </Button>
                </form>
              )}
              {(error || list.error || detail.error) && (
                <p role="alert" className="text-destructive">
                  {error ?? list.error?.message ?? detail.error?.message}
                </p>
              )}
              {detail.isLoading ? (
                <p>Loading parts…</p>
              ) : (
                data && (
                  <>
                    <p className="text-muted-foreground text-sm">
                      {selected
                        ? "Only included parts can use this book. Other parts use standard pricing."
                        : "Standard pricing applies unless the job has a selected book containing that part."}
                    </p>
                    <div className="flex items-center gap-2">
                      <Input
                        aria-label="Search price book parts"
                        placeholder="Search parts or SKU"
                        value={search}
                        onChange={(e) => {
                          setSearch(e.target.value);
                          setLimit(50);
                        }}
                      />
                      {selected && (
                        <label className="flex shrink-0 gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={all}
                            onChange={(e) => setAll(e.target.checked)}
                          />
                          Show all parts
                        </label>
                      )}
                      {!selected && data.canManage && (
                        <Button
                          variant="outline"
                          onClick={() => setStandardEditor(true)}
                        >
                          Edit Standard
                        </Button>
                      )}
                    </div>
                    <div className="divide-y">
                      {rows.slice(0, limit).map((row) => (
                        <div key={row.id} className="space-y-2 py-3">
                          <div className="flex items-center gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm">{row.name}</p>
                              <p className="text-muted-foreground text-xs">
                                {row.sku ?? "No SKU"}
                                {selected && !row.included
                                  ? " · Not in this book"
                                  : ""}
                              </p>
                            </div>
                            {data.showPrices && (
                              <span className="shrink-0 text-sm">
                                {row.unitCost === null
                                  ? "No price"
                                  : `$${Number(row.unitCost).toFixed(2)}`}
                                {row.priceStatus === "estimated" && (
                                  <small className="text-muted-foreground block">
                                    Estimated
                                  </small>
                                )}
                              </span>
                            )}
                            {selected && data.canManage && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setEditing(row.id);
                                  setPrice(row.unitCost ?? "");
                                  setStatus(
                                    row.priceStatus === "confirmed"
                                      ? "confirmed"
                                      : row.priceStatus === "estimated"
                                        ? "estimated"
                                        : "none",
                                  );
                                  setError(null);
                                }}
                              >
                                {row.included ? "Edit" : "Include"}
                              </Button>
                            )}
                          </div>
                          {editing === row.id && (
                            <div className="flex flex-wrap gap-2">
                              <Input
                                className="w-32"
                                aria-label="Book price"
                                inputMode="decimal"
                                value={price}
                                onChange={(e) => {
                                  setPrice(e.target.value);
                                  if (
                                    e.target.value.trim() &&
                                    status === "none"
                                  )
                                    setStatus("estimated");
                                  if (!e.target.value.trim()) setStatus("none");
                                }}
                              />
                              <select
                                aria-label="Price status"
                                className="bg-background rounded border px-2"
                                value={status}
                                onChange={(e) =>
                                  setStatus(e.target.value as typeof status)
                                }
                              >
                                <option value="none">No price</option>
                                <option value="estimated">Estimated</option>
                                <option value="confirmed">Confirmed</option>
                              </select>
                              <Button
                                disabled={save.isPending}
                                onClick={() => saveRow(row.id, true)}
                              >
                                Save
                              </Button>
                              {row.included && (
                                <Button
                                  variant="outline"
                                  disabled={save.isPending}
                                  onClick={() => saveRow(row.id, false)}
                                >
                                  Remove from book
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                onClick={() => setEditing(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    {rows.length > limit && (
                      <Button
                        variant="outline"
                        onClick={() => setLimit((n) => n + 50)}
                      >
                        Show more ({rows.length - limit} remaining)
                      </Button>
                    )}
                    {!rows.length && (
                      <p className="text-muted-foreground text-sm">
                        No parts to show.{" "}
                        {selected
                          ? "Select Show all parts to include supplier parts in this book."
                          : "Add supplier parts to establish standard pricing."}
                      </p>
                    )}
                  </>
                )
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
      {standardEditor && (
        <SupplierPartsDialog
          open
          supplierId={supplierId}
          onOpenChange={(open) => {
            setStandardEditor(open);
            if (!open) void refresh();
          }}
        />
      )}
    </>
  );
}
