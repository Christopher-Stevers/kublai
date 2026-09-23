// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

it("bounds downloads, deduplicates messages and prioritizes visible photos", async () => {
  const started: string[] = [];
  const pending: Array<() => void> = [];
  let active = 0,
    peak = 0;
  const cached = new Map<string, Response>();
  const context = {
    self: {
      addEventListener: () => {},
      location: { origin: "https://test.local" },
    },
    caches: {
      open: async () => ({
        match: async (r: Request) => cached.get(r.url)?.clone(),
        put: async (r: Request, v: Response) => {
          cached.set(r.url, v);
        },
      }),
    },
    Request,
    Response,
    URL,
    console,
    fetch: async (r: Request) => {
      started.push(r.url);
      peak = Math.max(peak, ++active);
      await new Promise<void>((resolve) => pending.push(resolve));
      active--;
      return new Response("photo");
    },
  };
  runInNewContext(
    readFileSync("public/sw.js", "utf8") + "\nglobalThis.enqueue = queueImage;",
    context,
  );
  const enqueue = (
    context as typeof context & {
      enqueue: (request: Request, visible?: boolean) => Promise<Response>;
    }
  ).enqueue;
  const request = (id: number) =>
    new Request(`https://test.local/images/${id}`);
  const work = Array.from({ length: 9 }, (_, i) => enqueue(request(i)));
  work.push(enqueue(request(8), true));
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  await tick();
  expect(started).toHaveLength(4);
  pending.splice(0).forEach((resolve) => resolve());
  await tick();
  expect(started[4]).toContain("/8");
  while (started.length < 9 || active) {
    pending.splice(0).forEach((resolve) => resolve());
    await tick();
  }
  const responses = await Promise.all(work);
  expect(await Promise.all(responses.map((r) => r.text()))).toEqual(
    Array(10).fill("photo"),
  );
  expect(peak).toBe(4);
  expect(started.filter((url) => url.endsWith("/8"))).toHaveLength(1);
  await enqueue(request(8));
  expect(started).toHaveLength(9);
});

it("uses the warmed original when an unseen thumbnail is requested offline", async () => {
  const original = new Response("cached original", { headers: { "content-type": "image/webp" } });
  const match = async (r: Request | string) => (typeof r === "string" ? r : r.url) === "https://test.local/images/part.webp" ? original.clone() : undefined;
  const context = {
    self: { addEventListener: () => {}, location: { origin: "https://test.local" } },
    caches: { match, open: async () => ({ match }) },
    Request, Response, URL, console,
    fetch: async () => { throw Error("offline"); },
  };
  runInNewContext(readFileSync("public/sw.js", "utf8") + "\nglobalThis.loadImage = cacheFirstImage;", context);
  const load = (context as typeof context & { loadImage: (r: Request) => Promise<Response> }).loadImage;
  const response = await load(new Request("https://test.local/_next/image?url=%2Fimages%2Fpart.webp&w=64&q=75"));
  expect(await response.text()).toBe("cached original");
  await expect(load(new Request("https://test.local/_next/image?url=https%3A%2F%2Fother.local%2Fpart.webp&w=64&q=75"))).rejects.toThrow("offline");
});
