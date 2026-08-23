// The authoritative clock is anchored to an API response and advanced with
// performance.now(), which is not affected by the device date/time setting.
let serverBaseMs = null;
let performanceBaseMs = null;

export function setServerTime(value) {
  const ms = new Date(value).getTime();
  if (!Number.isNaN(ms)) {
    serverBaseMs = ms;
    performanceBaseMs = performance.now();
  }
}

export function serverNowMs() {
  if (serverBaseMs === null || performanceBaseMs === null) return Date.now();
  return serverBaseMs + (performance.now() - performanceBaseMs);
}
