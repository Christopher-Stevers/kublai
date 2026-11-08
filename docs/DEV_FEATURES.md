# Development-only features

Models, Voice, Draws, Estimating, Timesheets, and Asset Management are controlled by the server-side `FOREMANHQ_DEV_FEATURES` flag.
The browser's Dev setting cannot enable them when the server disables them.

- `pnpm dev`: enabled by default; set `FOREMANHQ_DEV_FEATURES=false` to hide/block them.
- Optimized local builds and AWS development: explicitly set `FOREMANHQ_DEV_FEATURES=true` in the runtime environment to enable them.
- Production: leave the flag unset or set it to `false`. Set `DEPLOY_ENVIRONMENT=production` for an unconditional block, even if a dev flag is accidentally copied.

A production-mode build defaults to disabled. AWS development also runs with
`NODE_ENV=production`, so it requires the explicit runtime opt-in above.
These are server runtime settings, not `NEXT_PUBLIC_` build arguments. Restart
the app after changing them. No authentication or permission checks are bypassed.

When disabled, the job cards and Voice provider are absent, the Models page
returns not found, the offline Models view is suppressed, and model/voice HTTP
and model tRPC operations are blocked. Systems pages and private packing-slip test
reviews are also gated. Shared Systems APIs retain their existing permission checks.

The four standalone menu pages are hidden in mobile, desktop, and landscape
navigation. Their nested pages and APIs are blocked too, including estimate
exports. Saved landing pages targeting them fall back to Jobs while disabled.
Orders and ordering within material lists remain available.

## Device setting and badges

Settings → Dev → Show Dev features controls visibility within a deployment
that permits dev features. Each flagged navigation item or job card has a Dev
badge. The setting is saved under `foremanhq.dev`; until changed, the former
`foremanhq.experimental` preference is respected. The old Experimental switch
is replaced. Systems and packing-slip test reviews retain their visibility
control through this same switch. Turning Dev off stops the Voice provider and
redirects open dev-only pages to Jobs. Production cannot be enabled by this
browser preference; the switch is disabled when the server disallows Dev.
