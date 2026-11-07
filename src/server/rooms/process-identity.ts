import { readFile } from "node:fs/promises";

export type ProcessIdentity = {
  pid: number;
  bootId: string;
  startTicks: string;
};
export async function processIdentity(
  pid = process.pid,
): Promise<ProcessIdentity | null> {
  try {
    const [bootId, stat] = await Promise.all([
      readFile("/proc/sys/kernel/random/boot_id", "utf8"),
      readFile(`/proc/${pid}/stat`, "utf8"),
    ]);
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    if (fields[0] === "Z") return null;
    return { pid, bootId: bootId.trim(), startTicks: fields[19]! };
  } catch {
    return null;
  }
}
export async function sameProcess(owner: ProcessIdentity) {
  const current = await processIdentity(owner.pid);
  return (
    current?.bootId === owner.bootId && current.startTicks === owner.startTicks
  );
}
