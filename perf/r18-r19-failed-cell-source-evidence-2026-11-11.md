# R18 versus R19: five R19 rejected cells

All samples below are preserved operation-variant samples from the same frozen v2 method. This is a descriptive comparison, not another gate or a replacement comparator. R19 remains rejected against predeclared baseline1.

| Journey / link | R18 median ms | R19 median ms |
|---|---:|---:|
| openjob / Site | 82.912 | 98.788 |
| openjob / Office | 86.194 | 99.262 |
| openmateriallist / Basement | 221.074 | 243.243 |
| openmateriallist / Site | 222.739 | 242.851 |
| changeqty / Site | 115.889 | 130.745 |

The JSON sibling retains all ten raw samples and their recorded browser measures per cell. Five samples per version do not establish a distribution or isolate host, scheduling, actionability, or component effects. No durations have been subtracted to infer a causal phase.

The immutable source trees differ in exactly four src files: JobsClient.tsx, QuantityControls.tsx, button.tsx, and use-press.ts. JobsClient changes chat overview badge/read options to useTierOneReadOptions while preserving its 30-second refresh declaration and options-view enable condition. QuantityControls opts its four increase/decrease buttons into attribute press feedback. Button forwards that explicit option, retaining state feedback by default. usePress implements attribute feedback without setPressedState for opted-in buttons; the state mode remains the default.

MaterialListScreen, MaterialListItem, the ordinary-row partition, list queries, route registry and JobActivityPanels have no source change between these frozen versions. That does not make the material-list runtime identical: its quantity buttons use the changed shared primitives, and changed client bundle bytes/chunk composition can affect startup/preparation. Source identity alone cannot explain the two material-list cell increases.

Open-job has a concrete changed badge query-options path, while Activity bookkeeping and openjob code-only preparation are unchanged. The raw outer durations establish that these particular samples were slower; they do not establish the badge change as the cause. Quantity has an explicit press-feedback implementation change, but its Site cell is mixed rather than uniformly slower: retain all five values rather than attributing a median shift to removed React updates.

The outer timer still encloses driver reads/click/assertion/two-rAF paint opportunities. Existing browser marks cover only their recorded intervals and do not supply missing input/actionability/commit stacks. No new profiling or runtime experiment was performed for this audit.
