/** False only when the browser can tell there is no camera at all. */
export async function hasCamera() {
  try {
    const devices = await navigator.mediaDevices?.enumerateDevices?.();
    return !devices || devices.some((device) => device.kind === "videoinput");
  } catch {
    return true;
  }
}
