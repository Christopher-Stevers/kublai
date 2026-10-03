import { NextResponse, type NextRequest } from "next/server";

/**
 * A web app manifest for one job's chat, so it can be added to the home screen
 * as its own icon that opens straight into that chat.
 *
 * Browsers fetch manifests without cookies, so this reads nothing private: the
 * label comes from the page that links it, and opening the chat still requires
 * sign-in and access to the job.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ICONS = [192, 512].flatMap((size) =>
  (["any", "maskable"] as const).map((purpose) => ({
    src: `/foremanhq/android-chrome-${size}x${size}.png`,
    sizes: `${size}x${size}`,
    type: "image/png",
    purpose,
  })),
);

function chatShortcutName(raw: string | null) {
  // Strip control characters and keep the label short enough for a home screen.
  const name = (raw ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
  return name || "Job";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  if (!UUID.test(jobId))
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const name = chatShortcutName(request.nextUrl.searchParams.get("name"));
  const chat = `/dashboard/jobs/${jobId}/chat`;
  return new NextResponse(
    JSON.stringify({
      id: chat,
      name: `${name} chat`,
      short_name: name.slice(0, 12),
      description: `ForemanHQ chat for ${name}`,
      start_url: chat,
      scope: "/",
      display: "standalone",
      background_color: "#f9fafb",
      theme_color: "#111827",
      icons: ICONS,
    }),
    {
      headers: {
        "content-type": "application/manifest+json; charset=utf-8",
        "cache-control": "public, max-age=3600",
      },
    },
  );
}
