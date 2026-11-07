import { runNextSuperScale } from "./runner";
try {
  await runNextSuperScale();
  process.exit(0);
} catch (error) {
  console.error("Super scale worker failed", error);
  process.exit(1);
}
