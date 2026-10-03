import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET } from "./route";

const jobId = "0391aed4-7773-47ec-9141-09df373ec008";
const get = (id: string, query = "") =>
  GET(new NextRequest(`http://localhost/chat-shortcut/${id}/manifest.webmanifest${query}`), {
    params: Promise.resolve({ jobId: id }),
  });

describe("job chat shortcut manifest", () => {
  it("opens straight into the job's chat under its own app id", async () => {
    const response = await get(jobId, "?name=Alma%20Phase%20%232");
    expect(response.headers.get("content-type")).toContain("application/manifest+json");
    const manifest = (await response.json()) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      id: `/dashboard/jobs/${jobId}/chat`,
      start_url: `/dashboard/jobs/${jobId}/chat`,
      name: "Alma Phase #2 chat",
      short_name: "Alma Phase #",
      display: "standalone",
    });
  });

  it("cleans the label and rejects anything but a job id", async () => {
    const manifest = (await (await get(jobId, `?name=%0A%20${"x".repeat(80)}`)).json()) as { name: string };
    expect(manifest.name).toBe(`${"x".repeat(40)} chat`);
    expect(((await (await get(jobId)).json()) as { name: string }).name).toBe("Job chat");
    expect((await get("../../etc")).status).toBe(404);
  });
});
