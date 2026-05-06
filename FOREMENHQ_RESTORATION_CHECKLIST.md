# ForemenHQ restoration checklist

Source of truth:
- `../memory/foremenhq-recovered-context-2026-04-26.md`
- `../memory/foremenhq-thread-export.md`
- `../memory/foremenhq-human-messages.md`

## Verified today
- Fresh rebuilt repo exists at `kublai/`
- Branch: `tim-development`
- `corepack pnpm check` ✅
- `corepack pnpm build` ✅

## Restoration priorities

### 1) Core workflow parity
- [x] Jobs → Material Lists → Orders/Quotes flow matches recovered behavior
- [x] Material list numbering is job-specific
- [x] Orders remain separate from quotes
- [x] Order state uses draft/sent consistently
- [x] Dead/missing material-list links fail safely

### 2) Catalog parity
- [x] Catalog supports fast search/filtering at scale
- [x] Part photos behave correctly
- [x] Category/material/size/description flow matches recovered UX
- [x] Duplicate detection / merge / alias support restored or designed
- [x] Sort order preserved in catalog workflows

### 3) XLSX parity
- [x] Import catalog from XLSX
- [x] Export catalog back to XLSX
- [x] Preserve customer-specific catalog round trips
- [x] Reconcile with separate parts editor workflow if still needed

### 4) Order/email parity
- [x] Email order formatting matches recovered thread intent
- [x] Include PO#, delivery date, delivery address, supplier info
- [x] Plain-text fallback stays clean
- [x] Per-part line formatting is correct

### 5) Mobile/offline parity
- [x] App remains responsive on mobile
- [x] Offline/local-first material-list behavior works cleanly
- [x] Prefetch/sync approach aligns with recovered April 5 direction
- [x] Search interactions do not freeze inputs

### 6) Contributor/audit UX
- [x] Material lists show creator/contributors correctly
- [x] Per-part contributor tagging behaves correctly

## Rule from recovered thread
Tim explicitly said on 2026-04-05 that a block of earlier messages was a mistake, except for the later direction around:
- prefetching parts data
- making selection instant
- local-first behavior
- temporary offline use
- efficient sync back to DB

That later direction should be treated as authoritative.
