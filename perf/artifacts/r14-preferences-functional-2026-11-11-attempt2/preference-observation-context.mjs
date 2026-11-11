/** Per-page evidence only; no application QueryCache or authority injection. */
export function createPreferenceObservationContext(contextId, report) {
  if (!["consumer", "producer"].includes(contextId))
    throw Error("Known observation context required");
  const state = {
    contextId,
    active: true,
    requests: [],
    frames: [],
    latestRole: null,
    latestPreference: null,
  };
  state.recordRequest = (data) => {
    const row = { ...data, contextId };
    state.requests.push(row);
    report.requests.push(row);
  };
  state.recordFrame = (data) => {
    if (!state.active) return;
    const row = { ...data, contextId };
    state.frames.push(row);
    report.frames.push(row);
  };
  state.setRole = (value) => {
    if (state.active) state.latestRole = value;
  };
  state.setPreference = (value) => {
    if (state.active) state.latestPreference = value;
  };
  return state;
}
