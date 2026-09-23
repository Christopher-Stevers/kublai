# Jev assistance

ForemenHQ has an on-demand AI assistance workspace at `/dashboard/assist`, linked from the catalogue, suppliers, material lists and drawings. It uses TypeSafe's documented Choice API at `https://api.typesafe.ai/v1/systemone`.

## Connect

Add `TYPESAFE_API_KEY` to the server's private `.env` or service environment. Keep it server-only; never prefix it with `NEXT_PUBLIC_`. Optionally set `TYPESAFE_MODEL` to a tested model version; the default is `jev-latest`. Restart the application after changing the environment. No database migration is needed.

The status panel reports configuration presence, not credential validity. Missing credentials disable requests. Invalid credentials, provider outages, rate limits, malformed responses and timeouts produce safe error messages without changing records. Provider response bodies and keys are not logged.

## Workflows

- **Find materials:** lexical and trade-alias retrieval (including saved part synonyms) supplies up to 20 candidates. Jev evaluates relevance; matching candidates appear first. This is shortlist reranking, not a full semantic index, so a product omitted by retrieval cannot be recovered by Jev. Adjust search terms if needed.
- **Match supplier products:** select an existing supplier listing; compare its name, SKU and pack data against catalogue candidates, including its currently linked part when available. The link is not evidence of correctness. Missing pack details require review. Suggestions open normal product editing controls; links and purchasing quantities never change automatically.
- **Organize catalogue:** suggest a category from the organization's first 254 alphabetically sorted categories and compare up to 20 similar parts for possible duplicates. A known material or size conflict prevents the model choosing an exact match. Review the product to apply edits through existing controls; no automatic merges or category assignments.
- **Check a material list:** review descriptions against selected products and units, 20 lines at a time. Flags missing units and nonpositive quantities deterministically. Does not estimate takeoff quantities, prices or engineering suitability.
- **Classify a drawing:** extract one selected sheet's PDF text in a separate process with a 30-second timeout and a 512 MB JavaScript heap limit. Send at most 24,000 characters to classify plans, elevations, sections, details, schedules, site plans or mixed sheets. The result is a suggestion, not a persisted sheet attribute. Image-only PDFs need OCR first. Does not alter the PDF, sheet name or room detection.
- **Review outlines:** only unconfirmed rooms, 20 at a time. Check normalized geometry and labels; deterministic checks flag invalid, degenerate or out-of-bounds shapes. Larger boundaries send area and bounds rather than every point. This cannot verify alignment with walls or determine completeness without the original drawing. Approved outlines are never selected or modified.

Results prioritize explicit concerns, uncertainty, and low confidence. Initial review thresholds are confidence < 0.8 or chosen-option probability < 0.85, plus deterministic warnings. These are conservative routing defaults, not validated accuracy thresholds. All results still require human judgment. Review marks are browser component state for the current visit; leaving/reloading loses them. Existing source editing endpoints retain their normal permissions and offline synchronization behavior.

## Boundaries

Every endpoint requires authenticated, approved organization membership. Each tool checks the relevant tab permission; supplier and material-list checks also require catalogue access. Source and related-record queries are organization-scoped. The backend accepts record IDs, never client-supplied product datasets or file paths. All calls are explicit user actions; there are no automatic calls during typing, uploads, orders or room detection.

Only product descriptions/specifications, extracted drawing text, or room labels/geometry needed by the selected check go to TypeSafe. Customer contact details, supplier contact details, authentication state, cost and pricing fields are excluded. The UI states that checks send selected information to TypeSafe.

One request is capped at 60 questions / 180 KB, with a 20-second provider timeout and no automatic retry. The current single-process server permits four concurrent runs and 20 runs per user per ten minutes. Multi-instance deployments need a shared limiter. Provider decisions are schema-checked, matched to exactly the submitted question IDs/options, and checked for valid probability distributions before rendering. Arbitrary returned IDs cannot be used as links or updates.

## Verification and rollout

`pnpm exec vitest run src/server/assist src/components/assist/AssistancePanel.test.tsx` tests the API boundary, authorization/scoping, six workflow paths, UI controls, geometry handling, and an actual PDF worker fixture. Provider responses are simulated; no live TypeSafe quality or latency is claimed.

Before considering any automatic application of suggestions, use labeled examples from real plans/products. Measure shortlist recall separately from Jev classification accuracy, include mismatching materials, multi-dimensional fittings, ambiguous abbreviations and pack sizes, and select confidence thresholds using held-out examples. Keep approved outlines immutable.

API contract checked against https://docs.typesafe.ai/api on 2026-09-20.
