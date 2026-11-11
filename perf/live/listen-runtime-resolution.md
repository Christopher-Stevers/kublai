# LISTEN version guard after webpack compilation

The R12 isolated compiled chunk replaced the previous direct
`createRequire(import.meta.url).resolve("postgres")` with webpack's numeric module
ID. Passing that ID to `path.dirname` failed inside the conservative catch, so
`installedPostgresVersion()` returned null and preference-topic readiness stayed
unsupported. This is an independent compiled-code defect; it does not turn any
incomplete R12 functional attempt into accepted evidence.

The adapter now invokes Node `createRequire` indirectly through `Reflect.apply`,
then resolves the installed package using the native resolver. The base is
`process.cwd()/package.json`, the canonical runtime working directory required
by the release launcher, rather than a temporary build/source path. It checks
that resolution produced an absolute filesystem path before reading package
metadata. Package name/version validation, exact 3.4.8 admission, private driver
shape checks, callback preservation, reconnect behavior and fail-closed HTTP
fallback remain unchanged. Unsupported/unresolvable versions never gain topic
readiness. Dependency upgrades must rerun the adapter and real LISTEN lifecycle
proofs; this does not remove the private-driver upgrade guard.

Verification: eight tests pass across the existing lifecycle suite and a new
bounded compiled fixture; scoped ESLint and diff whitespace checks are clean.
The fixture transpiles only this adapter and uses Next's installed webpack in
production mode. It then deletes the original/transpiled staging directory and
runs the resulting CommonJS output in fresh bounded Node processes with separate
runtime working directories. Real installed 3.4.8 resolves and admits a matching
LISTEN shape; 3.4.9 metadata resolves but is rejected. Temporary trees and symlinks
are cleaned. Fixture minification is disabled because Next supplies its own
minifier and its vendored standalone webpack lacks Terser; the relevant resolver
rewrite occurs during parsing, before minification.

No full canonical application build, live database, worker release, schema,
service configuration, hint producer or activation changed in this slice. The
next canonical build/functional run must still confirm the actual compiled
application's readiness contract. Rollback restores only the adapter lookup and
therefore conservatively restores the unsupported/fallback behavior.
