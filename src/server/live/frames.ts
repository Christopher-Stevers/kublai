import type { LiveHint } from "~/lib/live-protocol";
export type SourceFrame = { event: string; id: string; data: string };
export function frameParser(onFrame: (frame: SourceFrame) => void) {
  let pending = "";
  return (chunk: string) => {
    pending = (pending + chunk).replace(/\r\n/g, "\n");
    if (pending.length > 256 * 1024) throw Error("Oversized live source frame");
    let end;
    while ((end = pending.indexOf("\n\n")) >= 0) {
      const block = pending.slice(0, end);
      pending = pending.slice(end + 2);
      let event = "message",
        id = "";
      const data = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("id:")) id = line.slice(3).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (data.length) onFrame({ event, id, data: data.join("\n") });
    }
  };
}
export function sourceHint(
  frame: SourceFrame,
):
  | (Omit<LiveHint, "version"> & { version?: number; revision?: string })
  | null {
  let value: any;
  try {
    value = JSON.parse(frame.data);
  } catch {
    return null;
  }
  const version = Number.isSafeInteger(value?.version)
    ? value.version
    : undefined;
  if (
    frame.event === "material-list-updated" &&
    typeof value?.materialListId === "string"
  )
    return {
      topic: "material",
      key: value.materialListId,
      kind: value.type,
      version,
    };
  if (frame.event === "replicache-poke")
    return {
      topic: "replicache",
      sourceClientGroupId: value?.sourceClientGroupId ?? null,
      version,
    };
  if (frame.event === "catalogue-updated")
    return { topic: "catalogue", version };
  if (frame.event === "conversations-updated")
    return {
      topic: "conversations",
      ...(typeof value?.revision === "string" &&
      /^[a-f0-9]{64}$/.test(value.revision)
        ? { revision: value.revision }
        : {}),
    };
  if (
    frame.event === "chat-updated" &&
    typeof value?.jobId === "string" &&
    Number.isSafeInteger(value.sequence)
  )
    return { topic: "chat", key: value.jobId, version: value.sequence };
  return null;
}
