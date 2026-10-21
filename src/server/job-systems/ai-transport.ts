import { lookup } from "node:dns/promises";
import { Agent, request } from "node:https";
import { isPublicPushAddress } from "~/server/chat/push-policy";
export function customEndpoint(base: string) {
  const url = new URL(base.replace(/\/+$/, "") + "/chat/completions");
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port && url.port !== "443")
  )
    throw Error(
      "Use a public HTTPS API base URL without credentials, query parameters, or a custom port.",
    );
  return url;
}
export async function customCompletion(
  base: string,
  key: string,
  body: string,
): Promise<unknown> {
  const url = customEndpoint(base);
  let timer: NodeJS.Timeout | undefined;
  const addresses = await Promise.race([
    lookup(url.hostname, { all: true }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(Error("AI provider DNS timed out.")),
        3000,
      );
    }),
  ]).finally(() => clearTimeout(timer));
  if (
    !addresses.length ||
    addresses.some((a) => !isPublicPushAddress(a.address))
  )
    throw Error("The AI provider must use a public internet address.");
  const agent = new Agent({
    lookup: (_host, options, callback) => {
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0]!.address, addresses[0]!.family);
    },
  });
  try {
    return await new Promise((resolve, reject) => {
      const req = request(
        url,
        {
          method: "POST",
          agent,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
            ...(key ? { Authorization: `Bearer ${key}` } : {}),
          },
        },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            reject(
              Error(
                `AI provider returned HTTP ${res.statusCode ?? 0}. Check the connection settings.`,
              ),
            );
            return;
          }
          let bytes = 0;
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 1_000_000)
              req.destroy(Error("AI response exceeded its size limit."));
            else chunks.push(chunk);
          });
          res.on("error", () =>
            reject(Error("AI provider response was interrupted.")),
          );
          res.on("end", () => {
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString()) as unknown);
            } catch {
              reject(Error("AI provider returned invalid JSON."));
            }
          });
        },
      );
      const deadline = setTimeout(
        () => req.destroy(Error("AI provider timed out.")),
        180_000,
      );
      req.on("close", () => clearTimeout(deadline));
      req.on("error", () =>
        reject(
          Error(
            "AI provider connection failed or timed out. Check the connection settings.",
          ),
        ),
      );
      req.end(body);
    });
  } finally {
    agent.destroy();
  }
}
