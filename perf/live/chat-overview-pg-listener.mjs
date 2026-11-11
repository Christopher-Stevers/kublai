import postgres from "postgres";
import {
  privateChatOptions,
  assertClientOptions,
  assertServerIdentity,
} from "./chat-overview-pg-guard.mjs";
const options = privateChatOptions(),
  client = postgres(options);
assertClientOptions(client, options); // Before any SQL, even the identity query.
const identity = await assertServerIdentity(client, options);
const subscribed = await client.listen("foremanhq_change", (payload) =>
  process.send?.({ type: "hint", payload }),
);
process.send?.({ type: "ready", identity });
async function stop() {
  await subscribed.unlisten();
  await client.end({ timeout: 2 });
  process.exit(0);
}
process.on("message", (message) => {
  if (message === "stop") void stop();
});
process.once("SIGTERM", () => void stop());
