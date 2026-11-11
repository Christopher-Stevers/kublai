# Chat overview producer proof — one executed attempt

All three tests passed with the reviewed3539993932ae9e6f752dbc43ee379ccf494393daaa7e404a3496a80e0c6635b6 manifest unchanged before/after (28 inputs). Actual join/read/mute changes delivered three independent-process LISTEN hints to the matching actor, zero to peer; no-op and rollback absence used acknowledged same-connection barriers. One observed42501 NOTIFY permission failure rolled back its nested savepoint while business rows before/after committed. Exactly one deliberate ERROR; zero unexpected ERROR/FATAL.

Listener exit0/PID absent, owned process family absent, final PG log copied after shutdown, private socket/data removed, final wrapper exit0. No retry.

Scope: producer foundation only; all browser polls unchanged. This injects a real private Drizzle client and a thin synthetic fixture, not the production db-module/auth path, compiled web topology, browser consumption or latency. Source alias uses immutable R19 schema; migration is the separately pinned committed0042 fixture. No worker/schema release, production write, app build or acceptance run occurred. The source manifest's prepared-unexecuted label records its creation-time status; actual execution is established by these test/identity/source/cleanup files.
