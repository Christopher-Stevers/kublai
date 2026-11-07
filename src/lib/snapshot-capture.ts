export type SnapshotRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export function snapshotRect(
  start: { x: number; y: number },
  end: { x: number; y: number },
  width: number,
  height: number,
): SnapshotRect {
  const a = {
    x: Math.min(width, Math.max(0, start.x)),
    y: Math.min(height, Math.max(0, start.y)),
  };
  const b = {
    x: Math.min(width, Math.max(0, end.x)),
    y: Math.min(height, Math.max(0, end.y)),
  };
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}
export function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Could not create the snapshot image.")),
      "image/png",
    ),
  );
}
export async function cropSnapshot(
  canvas: HTMLCanvasElement,
  rect: SnapshotRect,
  viewport: { width: number; height: number },
) {
  const ratioX = canvas.width / viewport.width,
    ratioY = canvas.height / viewport.height;
  const cropped = document.createElement("canvas");
  cropped.width = Math.max(1, Math.round(rect.width * ratioX));
  cropped.height = Math.max(1, Math.round(rect.height * ratioY));
  const ctx = cropped.getContext("2d");
  if (!ctx) throw new Error("Image capture is unavailable in this browser.");
  ctx.drawImage(
    canvas,
    rect.x * ratioX,
    rect.y * ratioY,
    rect.width * ratioX,
    rect.height * ratioY,
    0,
    0,
    cropped.width,
    cropped.height,
  );
  const blob = await canvasBlob(cropped);
  if (blob.size > 10 * 1024 * 1024)
    throw new Error("This snapshot is too large. Select a smaller area.");
  return blob;
}
export function needsScreenCapture() {
  return [...document.querySelectorAll("iframe")].some((frame) => {
    if (frame.closest("[data-snapshot-ui]")) return false;
    const rect = frame.getBoundingClientRect();
    if (
      !rect.width ||
      !rect.height ||
      rect.bottom <= 0 ||
      rect.top >= innerHeight
    )
      return false;
    try {
      return !frame.contentDocument;
    } catch {
      return true;
    }
  });
}
export async function captureVisiblePage() {
  const { toSvg } = await import("html-to-image");
  const visible = (node: Element) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.right > 0 &&
      rect.left < innerWidth &&
      rect.bottom > 0 &&
      rect.top < innerHeight &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0" &&
      !node.closest("[data-snapshot-ui]")
    );
  };
  // Loading a drawing can finish after the menu opens. Wait for visible assets,
  // then let their load handlers settle the sheet's fit before freezing it.
  let stopped = false;
  const ready = async () => {
    await Promise.all(
      [...document.querySelectorAll("img")]
        .filter(visible)
        .map((image) => image.decode()),
    );
    while (
      !stopped &&
      [...document.querySelectorAll('[data-snapshot-rendering="true"]')].some(
        visible,
      )
    )
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
  };
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      ready(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new Error(
                "The document is still loading. Try Snapshot again when it is ready.",
              ),
            ),
          15_000,
        );
      }),
    ]);
  } finally {
    stopped = true;
    clearTimeout(timeout);
  }
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  const width = innerWidth,
    height = innerHeight;
  const ratio = Math.min(
    devicePixelRatio || 1,
    2,
    Math.sqrt(8_000_000 / (width * height)),
  );
  // PDF views keep a hidden back buffer which can become visible while the
  // asynchronous DOM clone runs. Never include a buffer hidden at capture time.
  const canvases = new Set(
    [...document.querySelectorAll("canvas")].filter(visible),
  );
  // SVG serialization does not preserve DOM scroll offsets. Tag only scrolled
  // containers, then shift their cloned children; never move the live document.
  const scrolled = [...document.querySelectorAll<HTMLElement>("*")].filter(
    (node) =>
      (node.scrollLeft || node.scrollTop) &&
      !node.closest("[data-snapshot-ui]"),
  );
  const positions = scrolled.map((node, index) => ({
    node,
    index,
    x: node.scrollLeft,
    y: node.scrollTop,
    previous: node.getAttribute("data-snapshot-scroll-position"),
  }));
  let source: string;
  try {
    for (const { node, index } of positions)
      node.setAttribute("data-snapshot-scroll-position", String(index));
    source = await toSvg(document.documentElement, {
      width,
      height,
      includeQueryParams: true,
      style: {
        width: `${width}px`,
        height: `${height}px`,
        margin: "0",
        overflow: "hidden",
      },
      filter: (node) =>
        !(node instanceof Element) ||
        (!node.hasAttribute("data-snapshot-ui") &&
          !["SCRIPT", "IFRAME"].includes(node.tagName) &&
          (!(node instanceof HTMLCanvasElement) || canvases.has(node))),
    });
  } finally {
    for (const { node, previous } of positions)
      if (previous === null)
        node.removeAttribute("data-snapshot-scroll-position");
      else node.setAttribute("data-snapshot-scroll-position", previous);
  }
  const xml = new DOMParser().parseFromString(
    decodeURIComponent(source.slice(source.indexOf(",") + 1)),
    "image/svg+xml",
  );
  for (const { index, x, y } of positions) {
    const clone = xml.querySelector<HTMLElement>(
      `[data-snapshot-scroll-position="${index}"]`,
    );
    if (!clone) continue;
    for (const child of Array.from(clone.children) as HTMLElement[]) {
      if (!child.style) continue;
      const existing =
        child.style.transform === "none" ? "" : child.style.transform;
      child.style.transform = `translate(${-x}px, ${-y}px) ${existing}`;
    }
    clone.removeAttribute("data-snapshot-scroll-position");
  }
  // Fixed app controls remain at their viewport position when the page scrolls.
  if (scrollX || scrollY)
    for (const node of xml.querySelectorAll<HTMLElement>("[style]")) {
      if (node.style.position === "fixed" || node.style.position === "sticky") {
        const existing =
          node.style.transform === "none" ? "" : node.style.transform;
        node.style.transform = `translate(${scrollX}px, ${scrollY}px) ${existing}`;
      }
    }
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(xml))}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image capture is unavailable in this browser.");
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}
/** Browser permission is requested only by the user's Capture screen click. */
export async function captureSharedScreen() {
  if (!navigator.mediaDevices?.getDisplayMedia)
    throw new Error(
      "This browser cannot capture the live Office editor. Open a PDF or image preview to use Snapshot here.",
    );
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: "browser" },
    audio: false,
  });
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    // The browser picker may grant permission instantly. Let the snapshot
    // prompt finish closing before taking a frame of the shared tab.
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    if (!video.videoWidth || !video.videoHeight)
      throw new Error("The shared screen is not ready. Try again.");
    const canvas = document.createElement("canvas");
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(innerWidth * ratio);
    canvas.height = Math.round(innerHeight * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Image capture is unavailable.");
    ctx.fillStyle = "#111827";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(
      canvas.width / video.videoWidth,
      canvas.height / video.videoHeight,
    );
    ctx.drawImage(
      video,
      (canvas.width - video.videoWidth * scale) / 2,
      (canvas.height - video.videoHeight * scale) / 2,
      video.videoWidth * scale,
      video.videoHeight * scale,
    );
    video.pause();
    video.srcObject = null;
    return canvas;
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
}
