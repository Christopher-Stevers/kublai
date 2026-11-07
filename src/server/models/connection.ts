import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  unlink,
  open,
  link,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { userCan } from "~/server/auth/permissions";
import type { ModelAccess } from "./access";
const root = path.resolve(
  process.env.BIM_STORAGE_ROOT ?? path.join(process.cwd(), "uploads", "bim"),
);
export const apsCredentialsSchema = z.object({
  clientId: z
    .string()
    .trim()
    .min(8)
    .max(200)
    .regex(/^[A-Za-z0-9_-]+$/),
  clientSecret: z.string().trim().min(8).max(500),
});
export type ApsCredentials = z.infer<typeof apsCredentialsSchema>;
export function canConfigureAutodesk(a: ModelAccess) {
  return a.canUpload && userCan(a.user, "org.settings");
}
const location = (id: string) =>
  path.join(root, z.string().uuid().parse(id), "autodesk.json");
async function durableWrite(file: string, bytes: string | Uint8Array) {
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function syncDirectory(file: string) {
  const handle = await open(path.dirname(file), "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function encryptionKey() {
  if (process.env.BIM_CREDENTIALS_KEY) {
    const key = Buffer.from(process.env.BIM_CREDENTIALS_KEY, "base64");
    if (key.length !== 32)
      throw Error("BIM_CREDENTIALS_KEY must be a base64 32-byte key.");
    return key;
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
  const file = path.join(root, ".credentials-key");
  try {
    return await readFile(file).then((key) => {
      if (key.length !== 32)
        throw Error("The BIM connection encryption key is invalid.");
      return key;
    });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const temp = file + "." + randomBytes(8).toString("hex");
  try {
    await durableWrite(temp, randomBytes(32));
    try {
      await link(temp, file);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    await syncDirectory(file);
  } finally {
    await unlink(temp).catch(() => undefined);
  }
  return readFile(file);
}
export async function readApsCredentials(
  organizationId: string,
): Promise<ApsCredentials | null> {
  let text: string;
  try {
    text = await readFile(location(organizationId), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return process.env.APS_ORGANIZATION_ID === organizationId &&
      process.env.APS_CLIENT_ID &&
      process.env.APS_CLIENT_SECRET
      ? {
          clientId: process.env.APS_CLIENT_ID,
          clientSecret: process.env.APS_CLIENT_SECRET,
        }
      : null;
  }
  const envelope = z
    .object({ iv: z.string(), tag: z.string(), ciphertext: z.string() })
    .parse(JSON.parse(text));
  const cipher = createDecipheriv(
    "aes-256-gcm",
    await encryptionKey(),
    Buffer.from(envelope.iv, "base64"),
  );
  cipher.setAAD(Buffer.from(organizationId));
  cipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const clear = Buffer.concat([
    cipher.update(Buffer.from(envelope.ciphertext, "base64")),
    cipher.final(),
  ]);
  return apsCredentialsSchema.parse(JSON.parse(clear.toString("utf8")));
}
export async function storeApsCredentials(
  a: ModelAccess,
  credentials: ApsCredentials,
) {
  if (!canConfigureAutodesk(a))
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Company settings and model upload permission are required to connect Autodesk.",
    });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await encryptionKey(), iv);
  cipher.setAAD(Buffer.from(a.job.organizationId));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(credentials), "utf8"),
    cipher.final(),
  ]);
  const file = location(a.job.organizationId);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + "." + randomBytes(8).toString("hex");
  try {
    await durableWrite(
      temp,
      JSON.stringify({
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
        ciphertext: ciphertext.toString("base64"),
      }),
    );
    await rename(temp, file);
    await syncDirectory(file);
  } finally {
    await unlink(temp).catch(() => undefined);
  }
  return { connected: true };
}
