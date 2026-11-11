# LISTEN version guard after webpack compilation

The R12 isolated compiled chunk replaced the previous direct
`createRequire(import.meta.url).resolve("postgres")` with webpack's numeric module
ID. Passing that ID to `path.dirname` failed inside the conservative catch, so
`installedPostgresVersion()` returned null and preference-topic readiness stayed
unsupported. This is an independent compiled-code defect; it does not turn any
incomplete R12 functional attempt into accepted evidence.

R13 then showed a second failure: webpack removed the named `createRequire`
import but left the indirect reference unbound. Its catch again returned null.
The earlier minimal `.mjs` fixture was insufficient: CommonJsImportsParserPlugin
runs on `javascript/auto`, not that strict ESM module type. The archived R13
regression evidence remains `e2431cce`; neither previous fixture pass is a full
application readiness pass.

The adapter now retains the native `node:module` namespace and dynamically reads
its factory. CommonJS exports Module as a function, so webpack's synthetic ESM
namespace may expose the native object only through `default`; both namespace
and default shapes are checked before use. There is no named factory import or
special static factory call for the parser to remove/rewrite. The base stays
`process.cwd()/package.json`, the canonical runtime working directory required
by the release launcher, rather than a temporary build/source path. Resolution
must produce an absolute filesystem path before metadata is read. Package
name/version validation, exact 3.4.8 admission, private-driver shape checks,
callback preservation, reconnect behavior and fail-closed HTTP fallback remain
unchanged. Dependency upgrades must rerun adapter and real LISTEN proofs.

Verification: eight tests pass across lifecycle and bounded compiled fixtures;
scoped ESLint and whitespace checks are clean. The fixture transpiles only this
adapter with installed Next webpack, production mode, explicit
`javascript/auto` and `parser.createRequire: true`. A named-import indirect-call
negative control now reproduces an unbound factory ReferenceError under that
same configuration. The corrected output resolves real installed 3.4.8 and
admits a matching LISTEN shape; 3.4.9 resolves but is rejected. Before execution,
the complete original/transpiled staging directory is deleted. Fresh bounded
Node processes use separate runtime working directories. Temporary trees,
symlinks and debug output files are cleaned. Fixture minification is disabled
because Next supplies its own minifier and its standalone vendored webpack lacks
Terser; the relevant import/resolve transformation precedes minification.

No full canonical application build, live database, worker release, schema,
service configuration, hint producer or activation changed in this slice. The
next canonical build/functional run must still confirm the actual compiled
application's readiness contract. Rollback restores only the adapter lookup and
therefore conservatively restores the unsupported/fallback behavior.
