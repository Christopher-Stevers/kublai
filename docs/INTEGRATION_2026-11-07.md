# November 7 application and AWS integration

This integration combines PR #8's deployed application (`bbb4dc11`) with
`development`, the AWS release work merged into PR #5 by PR #7, and PR #6's
infrastructure history. Application conflicts favor PR #8 as requested. Earlier
integration snapshots #3 and #4 are ancestors of this result.

The current app's catalogue, material-list UI, pack quantity controls, seed logic,
permission checks, and receiving workflows are retained. The older dashboard
catalogue route and part-type wizard stay removed. Development's additive assets,
spreadsheet parser/export utility and catalogue JSON remain in source; its older
conflicting UI and seeder do not replace the current implementation. The existing
part sort-order field is not duplicated. An idempotent legacy
reconciliation adds the field only if missing.

AWS uses the newer release configuration: 4 GiB app host, bounded drawing-worker
cgroups, private RDS, dedicated runtime/migration credentials, DNS/TLS configuration,
OIDC/SSM deployment, and guarded Stripe checkout. PR #6's older 2 GiB host default
and narrower pre-migration SSM policy must not replace this configuration.

## Schema compatibility

The generated AWS migration adds the newer receiving, reader, diagnostics and
sorting tables and fields without deleting existing data. The follow-up custom
migration preserves pricing-sync triggers, order-number allocation/initialization,
and worker validation constraints that Drizzle snapshots do not represent.
Existing AWS baseline migrations remain unchanged. The legacy developer database
uses `drizzle/`; never apply the AWS baseline to that populated database.

CI verifies fresh/repeated migrations, runtime grants, organization isolation,
pricing-sync triggers and order counters. It also runs receiving/catalogue UI and
background regressions alongside the existing authentication and billing tests.
The Journeyman permission test now reflects PR #8's existing chat access.

## Release behavior

Repository release/deployment switches were both enabled when reviewed. Merging
this branch into `development` triggers the existing AWS build-and-deploy pipeline.
Pull-request runs build and validate without deploying. Terraform validation is
read-only; a Git merge does not apply Terraform or change DNS. Deployment runs the
versioned AWS migrations, tests the candidate's app/database health and can restore
the preceding image if startup fails; it does not undo applied database migrations.
Full user login, representative drawing/upload acceptance, and real billing
acceptance remain separate operational checks. Stripe checkout stays guarded by
its existing explicit enablement flag.

## Validation and inherited lint debt

The combined production build passed with TypeScript validation. Local isolated
PostgreSQL tests passed 86 receiving and 43 purchasing cases, plus fresh/repeated
AWS migrations and runtime/trigger checks. Corrected fixture regressions passed
192 tests; catalogue importer tests passed 16 and reliability checks passed 28.
The two initial UI/auth failures passed on Node 22 after aligning the existing
Journeyman permission expectation; CI also uses Node 22.

The saved lint baseline predates the deployed app. Its additional 411 findings
were traced to unchanged source lines in the integration parents: 404 in PR #8
and seven in development's additive XLSX utilities. Those inherited findings are
recorded in the baseline; no lint rules were disabled. This does not claim the
application is free of lint debt. Newly introduced findings remain blocking.
