/** Web requests persist jobs; only the dedicated service claims them in this mode. */
export const separateBackground = () =>
  process.env.FOREMANHQ_BACKGROUND_MODE === "separate";
export const canDispatchBackground = () =>
  !separateBackground() || process.env.FOREMANHQ_PROCESS_ROLE === "worker";
