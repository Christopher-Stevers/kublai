import { registerHooks } from "node:module";

const stub = new URL("./clerk-stub.mjs", import.meta.url).href;
const stubbed = new Set(["@clerk/nextjs/server", "server-only", "next/headers"]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (stubbed.has(specifier)) return { url: stub, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
