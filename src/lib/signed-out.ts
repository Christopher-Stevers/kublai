/** Marks the 401 the server sends API calls once the sign-in has lapsed,
 * so the app can tell it apart from other failures. */
export const SIGNED_OUT_HEADER = "x-foremanhq-signed-out";
export const SIGNED_OUT_CODE = "SIGNED_OUT";
export const SIGNED_OUT_MESSAGE =
  "Sign in again to sync. Your changes are kept on this device.";

export class SignedOutError extends Error {
  readonly code = SIGNED_OUT_CODE;
  constructor() {
    super(SIGNED_OUT_MESSAGE);
    this.name = "SignedOutError";
  }
}
