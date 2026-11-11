# Remaining observed writes — next-caller audit and photo slice

The inventory has twenty **procedures**, not twenty independently measured UI
callers. Counts are seven-day journal observations and can include QA. Six
procedures have scoped prepared conversions: hide/show catalogue choices, order
notes, individual receipt verification, move drawing folder and rename sheet.
The last two are documented separately in `instant-writes-navigation.md`; the
older four-row master table must not be read as excluding them. The subsequent prepared photo slice adds a narrow seventh procedure case, as
documented below; it is not activated or included in the R3 canonical artifact.

| Procedure                                | Calls | Current decision                                                                                                                                                        |
| ---------------------------------------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| catalogue.hideParts                      |   117 | Converted: reviewed reversible visibility, confirmation/release preserved                                                                                               |
| drawingsWorkspace.applySuperLabel        |    87 | Accurate pending feedback implemented; real recognition output remains authoritative, not counted converted                                                             |
| materialList.updateOrderItemVerification |    76 | Converted: ephemeral receipt preview, rollback/authority bridge and bulk ordering                                                                                       |
| drawingsWorkspace.save                   |    67 | Preserve existing private queued edits/public optimistic overlays; mixed kinds cannot be blanket-counted as newly converted                                             |
| drawingsWorkspace.openDocument           |    48 | Real page records/IDs/access required; cached opening already has a device path                                                                                         |
| drawingsWorkspace.archive                |    36 | Destructive/shared lifecycle, excluded from automatic conversion                                                                                                        |
| materialList.sendGeneratedOrder          |    10 | External send, keep explicit release and authoritative outcome                                                                                                          |
| catalogue.createPart                     |     8 | Server-generated identity and supplier listing follow-up; no fake completed part or dependent list action                                                               |
| materialList.merge                       |     7 | Bulk/destructive identity reconciliation, excluded                                                                                                                      |
| catalogue.updatePart                     |     5 | Prepared seventh-procedure partial coverage: only existing organization-owned stored/uploaded photo attachment; descriptive/engineering/full-form save remains excluded |
| user.finishTutorial                      |     2 | Existing local progress/token-fenced serialized sync is already immediate; preserve it, do not add a second queue                                                       |
| drawingsWorkspace.setScale               |     2 | Shared measurement/revision semantics, excluded here                                                                                                                    |
| catalogue.showHiddenParts                |     2 | Converted                                                                                                                                                               |
| drawings.createSet                       |     2 | Real folder ID/dependent actions need separate temporary-state design                                                                                                   |
| organization.updateOrganizationMember    |     2 | Permission-sensitive, excluded                                                                                                                                          |
| drawings.moveSet                         |     2 | Converted                                                                                                                                                               |
| materialList.markAllOrderItemsReceived   |     1 | Authoritative credited/bulk quantities; pending/offline/ordering repaired, no fabricated bulk success                                                                   |
| materialList.updateOrderNotes            |     1 | Converted                                                                                                                                                               |
| drawings.renameSheet                     |     1 | Converted                                                                                                                                                               |
| chat.join                                |     1 | Access/membership assertion; never claim successful membership locally                                                                                                  |

## Three next caller actions, all sharing updatePart's five observed calls

These are source-reviewed caller cases, **not three additional measured procedures**. Cases 2–3 now have the prepared implementation/proof below; case 1 remains a proposal.
The inventory does not partition the five calls among them. Converting all three
would at most move procedure coverage from six to seven of twenty, with explicit
input/caller exclusions still necessary.

1. **Organization-owned descriptive metadata save** in
   `src/components/catalogue/PartDetailsDialog.tsx`, `handleSubmit` around line
   1138, using the existing `updatePart` mutation at line 666. Restrict the first
   pass to changed display name/description/aliases with pack quantities, units,
   size, category, tracking, visibility, supplier/price fields unchanged. Preview
   typed `catalogue.getPart` descriptive fields in the initiating call and close
   only after retaining the user's draft for a refusal/reopen. Begin/rollback must
   preserve query instance/value ownership and account fencing. The catalogue
   list may read Replicache, so changing only TanStack detail data is insufficient
   proof of immediate list paint: audit the actual reader and use a short-lived
   presentation overlay if needed, not an unacknowledged durable Replicache write.
   Server normalization/reconciliation and pull remain authoritative.
2. **Attach an already-stored catalogue image URL** in
   `PartDetailsDialog.tsx:applyRemoteGoogleImageUrl` around lines 744–757,
   specifically the `isStoredCatalogueImageUrl(trimmedUrl)` branch. It currently
   sets local image state immediately but awaits `updatePart` before closing the
   picker and has no owned rollback of that local image on refusal. Cache/local
   image preview and picker closure can be immediate, then reconcile or restore
   the old accepted image with the failed selection retained for retry. Restrict
   to existing organization-owned parts and accepted stored URLs. The separate
   remote Google acquisition procedure must finish successfully before claiming
   an image exists; never invent upload/download results.
3. **Attach a successfully uploaded photo** in
   `PartDetailsDialog.tsx:attachUploadedImageToPart` around lines 769–778. Await
   the real `uploadPartImage(file)` result first; only the following updatePart
   attachment can become immediate with the same typed image/cache rollback as
   case 2. Upload success does not prove attachment success. Keep orphan-asset
   cleanup separate: do not delete a shared/new upload during optimistic rollback.
   This is a network-free attachment preview after real upload, not an instant
   upload or a newly measured high-volume action.

For all three, `src/server/api/routers/catalogue.ts:updatePart` checks edit/delete
capabilities and organization ownership, can find/create normalized size records,
and contains a global-to-organization-copy branch returning a different identity.
Do not optimistically patch global/shared parts or assume the ID cannot change.
The current organization-filtered lookup and the copy branch also warrant
separate server-contract tests before claiming global-copy behavior works. An
`isActive:false` edit has a distinct delete permission and is excluded here.
Cached edit capability is not a grant; mutation rejection, account change,
authoritative refresh and late-result handling must keep their existing fences.

Focused next proof should cover organization-only eligibility, metadata-only
payload bounds, immediate visible reader paint, refused attachment/name rollback,
newer server refresh winning, account wipe/late result, overlapping calls, offline
failure/no replay, normalization and different-ID refusal/reconciliation. The original audit performed no implementation; the later photo-only preparation
is recorded separately below. No production writes/private browser reads or full
build were performed in this follow-up.

## Prepared photo-only implementation and verification

`useInstantPartImage` shares the existing `useInstantMutation` and typed
`beginInstantQueryUpdate`. The wire payload is `{partId,imageUrl,expectedAccountKey}`; only the first two are part data. It
requires a current account, open/online eligible editor, current part ID and a
cached `catalogue.getPart` with `isOrgSpecific:true`; missing/global data or
unstored/remote URL inputs cannot preview or send. Stored photo selection changes
the detail/local image and closes the picker in the initiating call. The picker clipboard/upload
caller first awaits an actual `uploadPartImage` response and only then invokes
attachment. It captures account/part/view ownership before upload; a removed or
changed view cannot start a late attachment. A temporarily hidden view can offer
that completed URL for explicit retry when it returns, without automatic write
replay.

The previous unsaved image draft is retained and restored when its owned preview
is refused. A new authoritative query value or independently changed local draft
wins instead. Pending locks prevent overlapping requests; the full-form submit
also checks the helper's synchronous pending state. A failed stored URL remains
available through Retry photo attachment. Unexpected different-ID results are
not claimed as successful attachment to the original part and require refresh.
`approvedImageUrl` changes only after accepted response, not during preview.
Account authority tokens, per-view generation and query-instance/value ownership
fence late responses and cleared caches. Reconciliation/pull after a request
already dispatched uses the captured account/read authority rather than view
identity, so closing or changing the editor cannot suppress the accepted
current-account refresh; UI callbacks stay view-fenced. Already-issued authorized requests are
not cancelled merely because the component is removed. Deferred UI correction
for a hidden retained view is local only, never a new persisted write queue.

The main form Upload button still edits its unsaved draft for the full-form save;
that separate full-form mutation is not converted here.

Catalogue grids use `ReplicacheCataloguePart.imageUrl` through shared catalogue
readers, not this detail query. This slice therefore claims immediate
**dialog/detail preview only**. It never inserts an unacknowledged image into a
Replicache row; cards update through the accepted catalogue pull/invalidation.
Descriptive metadata, global-copy/new IDs, createPart, photo acquisition/model
results, engineering/pack/unit/price fields and unrelated full-form saves remain
outside this conversion.

The focused one-worker run passed **38 tests in three files**: real QueryClient
photo transaction tests, existing/new PartDetailsDialog regressions and router account-guard tests. New UI
cases hold the attachment response pending to prove photo paint/picker closure,
and hold the upload response pending to prove no invented upload/early
attachment. The stored-image case also changes the returned part object while
retaining an unrelated name/description draft. Other cases cover refusal,
normalization/acceptance, independent local draft, newer authority, missing/global
inputs, wrong IDs, account clear/change, completed upload after removal,
overlapping calls, offline and explicit eligibility failure with no reconnect
replay. Initial tests exposed a real structural-sharing rollback issue; rollback
now records pre-rollback ownership and the actual restored reference instead of
assuming it equals the original cache object.

New hook/helper/router test lint is clean. The five existing PartDetailsDialog lint errors were
reproduced exactly on committed HEAD: two nullish-coalescing rules, two unsafe
category accesses and the existing `useFamilyImage` naming/rules-of-hooks issue.
The server router has 107 lint errors, likewise reproduced on committed HEAD; the identity guard adds none. No global formatting was applied to the dialog or router. No full typecheck/canonical
build, deployment, phone frame timing, additional procedure usage count or
outside-dialog instant-card proof is claimed.

The helper captures the exact account key before client invocation/upload and
sends it as optional `expectedAccountKey`. The router compares it with
`liveAccountScope(ctx.user.organizationId,ctx.userId,ctx.simulation?.id)` before
feature edit checks or DB work, returning CONFLICT on mismatch. It is never
parsed or persisted through the part update fields. Legacy callers omitting it
keep their previous behavior. Tests cover direct/simulation matches, different
user/organization/simulation, simulation-to-direct changes, legacy omission,
zero DB/edit-permission calls on mismatch and retention of the original key while
the transport delays. This closes the actor-at-dispatch gap for these guarded
photo callers without changing shared batching, schema or worker code.
