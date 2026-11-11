let cached;
let waiters = [];
let calls = 0;
export const cachedPartImageLayouts = () => cached;
export const isCatalogueImageSource = (source) =>
  /^\/api\/catalogue\/images\/[^/?#]+$/.test(source);
export function loadPartImageLayouts() {
  calls++;
  return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
}
window.metadataFixture = {
  resolve(value) {
    cached = value;
    const pending = waiters;
    waiters = [];
    pending.forEach(({ resolve }) => resolve(value));
  },
  reject() {
    const pending = waiters;
    waiters = [];
    pending.forEach(({ reject }) =>
      reject(new Error("synthetic metadata unavailable")),
    );
  },
  reset() {
    cached = undefined;
    waiters = [];
    calls = 0;
  },
  calls: () => calls,
};
