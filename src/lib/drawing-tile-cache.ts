import type { DrawingTileRequest } from "./drawing-tiles";

/** Decoded surfaces, including in-flight images, are bounded on small phones. */
export const DRAWING_TILE_BYTES = 32 * 1024 * 1024;
const DOWNLOADS = 4;
type Entry = {
  image: HTMLImageElement;
  request: DrawingTileRequest;
  bytes: number;
  ready: boolean;
  used: number;
};

/**
 * Keeps the actual decoded image nodes through gestures. Native HTTP caching
 * alone cannot prevent an unmounted image needing another decode/GPU upload.
 * Network requests follow the latest viewport; finished pixels stay until the
 * bounded cache needs their space. No full-sheet high-resolution allocation.
 */
export class DrawingTileCache {
  private entries = new Map<string, Entry>();
  private wanted: DrawingTileRequest[] = [];
  private clock = 0;
  private active = 0;
  private disposed = false;
  private failures = new Map<string, { attempts: number; retryAt: number }>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly budget = DRAWING_TILE_BYTES,
    private readonly makeImage: () => HTMLImageElement = () => new Image(),
  ) {}

  update(requests: DrawingTileRequest[]) {
    if (this.disposed) return;
    let reserved = 0;
    this.wanted = requests.filter((request) => {
      const bytes = request.width * request.height * 4;
      if (reserved + bytes > this.budget) return false;
      reserved += bytes;
      return true;
    });
    for (const request of this.wanted) {
      const entry = this.entries.get(request.key);
      if (entry) entry.used = ++this.clock;
    }
    this.pump();
  }

  private pump() {
    if (this.disposed) return;
    const wantedKeys = new Set(this.wanted.map((request) => request.key));
    for (const request of this.wanted) {
      if (this.active >= DOWNLOADS) break;
      const failure = this.failures.get(request.key);
      if (this.entries.has(request.key) || (failure && (failure.attempts >= 3 || Date.now() < failure.retryAt))) continue;
      const bytes = request.width * request.height * 4;
      let occupied = [...this.entries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
      const victims = [...this.entries.entries()]
        .filter(([key, entry]) => entry.ready && !wantedKeys.has(key))
        .sort((a, b) => a[1].used - b[1].used);
      for (const [key, victim] of victims) {
        if (occupied + bytes <= this.budget) break;
        occupied -= victim.bytes;
        victim.image.remove();
        victim.image.removeAttribute("src");
        this.entries.delete(key);
      }
      if (occupied + bytes > this.budget) continue;
      this.start(request, bytes);
    }
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const retryAt = this.wanted.reduce((soonest, request) => {
      const failure = this.failures.get(request.key);
      return failure && failure.attempts < 3 && failure.retryAt > Date.now()
        ? Math.min(soonest, failure.retryAt) : soonest;
    }, Infinity);
    if (Number.isFinite(retryAt)) {
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.pump();
      }, Math.max(0, retryAt - Date.now()));
    }
  }

  private start(request: DrawingTileRequest, bytes: number) {
    const image = this.makeImage();
    const entry: Entry = { image, request, bytes, ready: false, used: ++this.clock };
    this.entries.set(request.key, entry);
    this.active++;
    image.alt = "";
    image.draggable = false;
    image.decoding = "async";
    image.fetchPriority = request.visible ? "high" : "low";
    image.dataset.drawingTile = request.key;
    Object.assign(image.style, {
      position: "absolute",
      left: `${request.col * request.tileSize / request.levelWidth * 100}%`,
      top: `${request.row * request.tileSize / request.levelHeight * 100}%`,
      width: `${request.width / request.levelWidth * 100}%`,
      height: `${request.height / request.levelHeight * 100}%`,
      zIndex: String(request.factor),
      pointerEvents: "none",
    });
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled || this.disposed) return;
      settled = true;
      image.onload = null;
      image.onerror = null;
      this.active--;
      if (ready) {
        entry.ready = true;
        this.failures.delete(request.key);
        this.container.append(image);
      } else {
        this.entries.delete(request.key);
        // A broken tile must not create a request loop on every pointer frame.
        const attempts = (this.failures.get(request.key)?.attempts ?? 0) + 1;
        this.failures.set(request.key, { attempts, retryAt: Date.now() + 3_000 * attempts });
        if (this.failures.size > 128) this.failures.delete(this.failures.keys().next().value!);
      }
      this.pump();
    };
    image.onload = () => {
      if (image.decode) {
        void image.decode().then(() => finish(true), () => finish(image.naturalWidth > 0));
      } else finish(true);
    };
    image.onerror = () => finish(false);
    image.src = request.url;
  }

  dispose() {
    this.disposed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    for (const { image } of this.entries.values()) {
      image.onload = null;
      image.onerror = null;
      image.remove();
      image.removeAttribute("src");
    }
    this.entries.clear();
    this.wanted = [];
    this.failures.clear();
  }
}
