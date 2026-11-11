# Office quantity: retained evidence comparison

All four captures use the same frozen 29-file `25dfa8bf…` timing method, ready-then-pinch-v2, 4× CPU and `operation` variant. Each retains all five Office quantity samples. Baseline1 remains the only gate comparator; baseline2 is stability context, not an alternate acceptance choice. R17/R18 source identities and all original reports remain unchanged.

| Capture | Five outer durations in run order (ms) | Outer median | Five write-to-paint marks (ms) | Mark median |
|---|---|---:|---|---:|
| Baseline1 | 111.414, 125.051, 114.144, 115.418, 109.109 | 114.144 | 26.5, 21.4, 21.4, 21.8, 18.7 | 21.4 |
| Baseline2 | 123.945, 115.103, 114.911, 109.355, 118.107 | 115.103 | 20.9, 21.6, 22.0, 16.9, 21.4 | 21.4 |
| R17 | 116.225, 133.133, 113.858, 120.521, 142.772 | 120.521 | 20.5, 20.7, 21.0, 20.7, 21.3 | 20.7 |
| R18 | 121.403, 115.976, 141.182, 132.094, 136.110 | 132.094 | 20.5, 21.3, 21.6, 21.0, 22.2 | 21.3 |

R18 exceeds baseline1 by 15.7265%, above the unchanged10% limit; the failure stands. No samples are trimmed, pooled, retried or substituted. Exact raw samples, report hashes and source hashes are in the sibling JSON.

The frozen adapter reads the first Quantity textbox's old value, default-clicks the first Increase quantity button, asserts the textbox value changed, and awaits two animation frames. The outer Node timer encloses that whole adapter, including driver/locator communication, actionability/input scheduling, the assertion and its own frame wait. Preparation occurs before that timer.

`QuantityControls.tsx` is byte-identical in frozen Phase0, R17 and R18. Its handler starts `write-to-paint` before marking the user action, local state updates and quantity commit, then invokes the completion callback. `startSpeedPaint` schedules two rAF callbacks before recording its measure. That mark observes a paint opportunity, not the instant of DOM mutation, actual displayed pixels, durable server ACK or same-frame proof. Its stable median does not isolate all work surrounding the action.

Quantity uses Button's default release behavior, not opt-in fixed pointerdown activation. The shared Button/usePress implementation differs from Phase0 but is unchanged between R17/R18; no per-sample event trace was retained. The two timers overlap and have different starts/ends, so their durations cannot be subtracted as disjoint driver/application phases. Existing data does not locate the extra outer time in input scheduling, render work, assertion polling or frame alignment. No diagnosis, alternative gate or runtime experiment is performed by this audit.
