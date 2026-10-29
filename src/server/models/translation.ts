import type { ApsCredentials } from "./connection";
const apiRoot = "https://developer.api.autodesk.com";
export async function verifyApsCredentials(credentials: ApsCredentials) {
  const response = await fetch(apiRoot + "/authentication/v2/token", {
    method: "POST",
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(
          credentials.clientId + ":" + credentials.clientSecret,
        ).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "data:read data:write data:create bucket:create bucket:read",
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw Error(
      "Autodesk authentication failed. Check the client ID and secret.",
    );
  const body = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!body.access_token)
    throw Error("Autodesk returned an invalid access token.");
  return {
    value: body.access_token,
    until: Date.now() + (Math.min(body.expires_in ?? 300, 3600) - 60) * 1000,
    clientId: credentials.clientId,
  };
}
