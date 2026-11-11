# Catalogue creation feedback

Later source slice, excluded from frozen R12. No production change or timing
claim is made by this note.

Part creation now uses one explicit direct tRPC request with a synchronous
in-flight latch. The existing Creating indicator appears while that request is
pending. Connectivity, the current open form and account are checked before
dispatch; there is no paused mutation or automatic reconnect replay. The optional
expectedAccountKey is checked against the effective organization/user/simulation
before the existing create permission check or database work. Legacy callers
remain compatible.

The create response includes the actual supplier-part ID from the existing
lookup or insert. PartDetailsDialog passes that real ID to its material-list
caller without another supplier lookup. Accepted creation closes the same form
without waiting for catalogue invalidation or Replicache pull. Refresh failures
cannot turn a confirmed write into a failed creation. An online/offline change
does not discard a real ACK belonging to the same still-open form.

Closing/reopening, actor replacement, read-authority revocation and unmount fence
late view callbacks. The still-current account is reconciled after an accepted
or uncertain attempt, even if the form has gone away. A network/unknown error
keeps the draft and says to check the catalogue before creating again; it does
not claim that nothing was saved. Explicit pre-write permission/input/actor
refusals retain their explanation. No part, supplier link or catalogue row is
invented locally. Existing create persistence is not made transactional by this
slice; a late server failure may still follow a partial write.

44 focused tests pass across the controller, real dialog integration, creation
router and existing account guard suites. These checks cover duplicate admission, actual
offline state, no reconnect replay, real-ID handoff, unknown ACK, refused draft,
changed form/account/authority, accepted response after a connectivity change,
unmounted reconciliation, synchronous or hung refresh, legacy server input,
simulation identity, and actual newly created/existing supplier-link output.
New hook/tests lint clean; existing dialog/router findings match committed HEAD
exactly (5 and 107 errors respectively). No full build or measured frame/phone
latency is claimed. Independent review caught and fixed the connectivity/ACK
ownership and synchronous-refresh failure cases before this checkpoint.
