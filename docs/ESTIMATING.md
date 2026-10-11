# ForemanHQ estimating

## Workflow

1. Open **Estimating** and create an estimate for an existing job.
2. Open **Organization pricebook**, download the CSV template, and import your actual material rates, labor hours, supplier, unit, currency, pack multiple, and price date. Rates and reusable assemblies belong to the organization. Saving a new pricebook does not silently reprice old estimates; use **Apply pricebook** in the estimate when you want a new snapshot.
3. **Add takeoff** from job drawings, catalogue materials, existing material lists, prefabs, or your saved assemblies. Select multiple drawings; extraction runs in successive batches of at most five. Cancellation stops before the next batch and preserves completed work.
4. Review source quantities against the drawings. Assign a compatible material to an unpriced measurement, enter missing scope and costs, and adjust labor, waste, pack multiples, area, trade, phase, or cost code. Measurements can be opened at their source sheet. Approving evidence records the estimator's review; it does not certify that all project scope was recovered automatically.
5. Enter proposal scope, exclusions, assumptions, customer information, alternates, and pricing settings. Save your working revision. Submit for review, approve, and then mark sent/won/lost as applicable. Approved and issued revisions are locked. Duplicate or restore a historical revision to start a new draft.
6. Download a customer PDF, private internal PDF, Excel workbook, or CSV. Customer proposals omit internal unit costs, profit breakdowns, and internal notes. Draft PDFs are clearly marked.
7. An approved or won CAD estimate can prepare a new material list from catalogue-linked scope. The list retains required quantities; supplier pack rounding is calculated for purchasing. This action does not send orders. Repeated clicks on the same approved snapshot return the same list. Non-material rows and unsupported units are reported as exclusions from the handoff.

## Calculation rules

- Demand is entered quantity multiplied by the assembly/repetition factor.
- Material requirement includes waste. Purchasing rounds combined compatible part quantities up to the supplier multiple. Material cost uses that purchase quantity. Labor uses demand and productivity, without inflating labor by material waste.
- Pack aggregation keeps different suppliers, units, prices, and pack multiples separate. Imported pricebook rows retain their rate identity. Independent manually entered rows are not accidentally combined.
- When several rows share a pack purchase, the worksheet allocates that purchase and its exact cost across those rows in proportion to their requirement. A fractional purchase share is a cost allocation; the combined material-list handoff retains the actual required quantity and rounds the combined supplier order.
- Material, labor, equipment, subcontract, and other costs are separately visible. Labor has an hourly rate, burden percentage, and productivity factor. Settings also include overhead, contingency, profit, and tax.
- **Markup** adds a percentage to cost. **Margin** solves for the selling price that produces that percentage of selling price as profit. They are distinct options.
- Calculations use decimal fractions and cent rounding rather than accumulating binary floating point currency errors. Proposal selling-price allocation preserves the estimate's exact subtotal in cents.
- The base bid excludes optional alternates. Selected alternates are included in the selling total. An alternate's incremental amount is calculated against the base bid; totals can differ from summing isolated alternatives because pack purchases can be shared.
- An estimate has one currency. There is no implicit currency conversion. A mismatched price currency must be corrected before approval.

## Drawing extraction: evidence and limits

Extraction reuses saved calibrated measurement markups (length, area, and count), explicit PDF quantity schedules, and optionally current room counts as low-confidence count allowances. Source evidence, units, drawing references, and confidence are retained on each row. Existing evidence is deduplicated on repeat imports.

Explicit schedule parsing requires quantity, unit, and description columns. Unscaled geometry, unsupported markups, image-only PDFs, ambiguous schedules, and source limits produce review notes; their missing quantities are not fabricated. Room counts are not room areas or complete installation quantities. The estimator remains responsible for interpreting scope that is absent from readable schedules or saved takeoffs.

Catalogue simulated prices are marked as simulations. A positive dollar amount alone does not make a price verified. Simulation provenance survives pricebook CSV export/import. Missing costs, simulated costs, stale price dates, incompatible currencies, and unreviewed included drawing evidence prevent bid approval. Disabled/excluded rows and optional alternates remain visible for review.

## Permissions and collaboration

The **Estimating** tab requires both estimating tab access and permission to see dollar values. Editing and approving estimates have separate organization permissions. Executive accounts receive the new permissions; other accounts can be granted them through organization permissions/presets.

All queries, mutations, drawing references, pricebooks, history, and exports enforce organization boundaries on the server. Employee simulation keeps the executive actor and effective employee identity in the audit history. Concurrent saves use revision checks. A conflict retains the unsaved workspace and offers a downloadable working copy, save-as-new, or explicit reload.

Pricebook changes and estimate revisions are audited. Issued estimates are snapshots rather than live links that silently change when catalogue prices change.

## Research informing this implementation

Reviewed primary product and workflow documentation on October 11, 2026:

| Product                                                                                                                                                                                     | Workflow studied                                                                                    | ForemanHQ implementation                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [Procore Estimating](https://www.procore.com/estimating) and [estimate workflow](https://support.procore.com/products/online/user-guide/project-level/estimating/tutorials/add-an-estimate) | Connected takeoff, cost library, estimate, proposal, review, and downstream project work            | Job-connected estimates, traceable takeoffs, organization pricebook, proposals, revision history, and material-list handoff |
| [Trimble Estimation Desktop](https://www.trimble.com/en/products/trimble-estimation-desktop)                                                                                                | Trade-focused labor/material pricing and reusable assemblies                                        | Separate labor/material rates, productivity, cost codes, supplier packs, prefab and assembly import                         |
| [STACK features](https://www.stackct.com/takeoff-and-estimate-pricing/)                                                                                                                     | Estimating worksheets, item/assembly libraries, scope rollups, and costs beyond measured quantities | Editable worksheet, assemblies, trade/area/cost-code rollups, equipment/subcontract/other costs and alternates              |
| [Bluebeam takeoffs](https://www.bluebeam.com/workflows/takeoffs-and-estimation/)                                                                                                            | Calibrated measurement markups, quantity links, and reviewable evidence                             | Reuse actual saved calibrated drawing measurements and link each imported row to its evidence                               |

These sources guide the workflow; this release does not claim to reproduce every capability of these products or establish comparative superiority. Automatic recognition of every unlabeled construction component, guaranteed complete scope recovery from arbitrary plans, supplier-live pricing integrations, RFQ/bid leveling, change-order contracts, and payroll/accounting exports are not implemented by this release.

## Operations and verification

Apply the additive estimating migration with `node scripts/ops/apply-estimating-migration.mjs` using the same environment as the server, then deploy the application. The migration creates organization-bound estimates, immutable revision history, pricing libraries, and pricing history without modifying existing jobs or material lists. SQL composite foreign keys prevent cross-organization history links.

Focused regression suites live under `src/lib/estimating`, `src/server/estimating`, the estimating export API route, and `src/components/estimating`. Backend integration tests require `ESTIMATING_TEST_SOCKET` pointing to an isolated PostgreSQL test instance; they create synthetic schemas and must never target production. They exercise real tRPC caller authorization, optimistic concurrency, imports, audit identity, and atomic material-list handoff. PDF exports use embedded fonts and are rendered for visual inspection. Browser layout checks use the actual components with isolated synthetic API data; those checks do not prove completeness on unseen drawings.
