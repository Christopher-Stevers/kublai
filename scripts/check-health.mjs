#!/usr/bin/env node

const target = process.env.HEALTHCHECK_URL ?? process.argv[2] ?? "http://127.0.0.1:3000/api/health";

const startedAt = Date.now();

try {
  const response = await fetch(target, {
    headers: {
      "user-agent": "foremanhq-healthcheck/1.0",
      accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
    },
  });

  const durationMs = Date.now() - startedAt;
  const bodyText = await response.text();

  let parsed = null;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    console.error(`Healthcheck failed: HTTP ${response.status} in ${durationMs}ms`);
    if (bodyText) {
      console.error(bodyText.slice(0, 500));
    }
    process.exit(1);
  }

  if (parsed && parsed.ok === false) {
    console.error(`Healthcheck failed: app reported unhealthy in ${durationMs}ms`);
    console.error(bodyText.slice(0, 500));
    process.exit(1);
  }

  console.log(`Healthcheck passed for ${target} in ${durationMs}ms`);
  if (parsed) {
    console.log(JSON.stringify(parsed));
  }
} catch (error) {
  console.error(`Healthcheck request failed for ${target}`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
