export const HEADER_BACK_STATE_EVENT = "foremenhq:header-back-state";
export const HEADER_BACK_REQUEST_EVENT = "foremenhq:header-back-request";

export type HeaderBackStateDetail = {
  visible: boolean;
};

export function setHeaderBackVisible(visible: boolean) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<HeaderBackStateDetail>(HEADER_BACK_STATE_EVENT, {
      detail: { visible },
    }),
  );
}

export function requestHeaderBack() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(HEADER_BACK_REQUEST_EVENT));
}
