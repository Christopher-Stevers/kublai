# Job documents

The **Documents** card in a job opens the document workspace for that job. It
includes private document management and an optional Collabora Online integration
for editing Word documents and Excel spreadsheets in the browser without a
Microsoft account. Collabora is a separate editor service; the integration remains
unavailable until that service and the application settings are configured.

The open-source editor is currently a pilot integration. Real file editing,
coauthoring and mobile workflows have passed local acceptance, and a persistent
public pilot service is running. Save and close requires a correlated storage
receipt; public acceptance verified that receipt and the downloaded edited file.
This module is a foundation for BIM 360-style workflows, with the remaining scope
recorded below.

## Capability matrix

| Capability | Current implementation | Remaining work for BIM 360-style parity |
| --- | --- | --- |
| Organization | Nested job folders, names, descriptions, tags and document status | Configurable attributes, document sets, title blocks and naming standards |
| File storage | Private uploads, authenticated downloads and immutable file versions | Resumable large uploads, malware scanning, publication processing and managed object storage |
| History | Version history, restore as a new version, stale-upload conflict protection and side-by-side PDF/image comparison | Graphical change highlighting, aligned overlays and 3D model comparison |
| File operations | Rename, move, copy, locks, recycle and restore | Batch processing, retention and purge policies |
| Discovery | Search/filter the accessible document list | Full-text indexing, OCR and saved searches |
| Access | Organization access and folder viewer/editor/manager permissions | External guests, company/role-based groups and richer access reports |
| Preview | Browser previews for supported PDF and image uploads; downloads for other files | CAD/BIM translation, a 2D/3D viewer, measurement and linked sheets |
| Collaboration | Document comments and activity history | Anchored graphical markups, issue/RFI links and notifications |
| Reviews | A named reviewer records approval or changes requested against selected versions; replacing/recycling a reviewed file supersedes the pending review | Reusable multi-step/group workflows, deadlines and controlled publication |
| Transmittals | Stored package records with document/version references, recipients, message and downloadable JSON manifests | ZIP archives of transmitted files, actual delivery and recipient receipts |
| Word and Excel | Collabora WOPI integration for local files, browser editing/coauthoring, new DOCX/XLSX creation and saved revisions; requires configured editor service. Optional existing Microsoft file links remain available | A supported production service and broader compatibility/load testing; full Microsoft-format compatibility is not guaranteed |
| Field access | Responsive online workspace | Offline document downloads, synchronization and conflict handling |

Transmittal creation records a package; its JSON manifest records the selected
document revisions without including the file bytes. It does not send email or
notify the listed recipients. The activity feed is application history, not a
tamper-evident or regulatory audit archive.

## Open-source Word and Excel editing

With Collabora configured, use **New Word document** or **New spreadsheet**, or
upload an existing `.docx` or `.xlsx` and open its editor. The integration also
accepts `.pptx`, `.odt`, `.ods` and `.odp` uploads. It edits the ForemanHQ file in an
embedded Collabora frame; it does not require a Microsoft tenant or work account.
Two authorized users can open the same document for a shared Collabora session.
Viewers and members blocked by another user's document lock open read-only.

Successful storage callbacks append immutable ForemanHQ revisions when the file
bytes changed. Saving supersedes a pending review of the earlier revision. Reviews
and transmittals capture saved revisions, so save and close the editor before
creating either. ForemanHQ document comments and Collabora's internal document
comments are separate. Legacy `.doc`/`.xls`, macros, advanced Excel features and
layout fidelity need separate compatibility assessment; renaming a file extension
does not convert its contents.

Use the editor's **Save & close** control and wait for confirmation. The host
keeps the frame open on a save failure or timeout. Browser crashes, closing the
entire browser tab and lost connectivity cannot guarantee a final asynchronous
save. Live sessions require a network connection; this is not offline editing.

### Pilot service configuration

Set these server-side environment variables:

| Variable | Purpose |
| --- | --- |
| `COLLABORA_URL` | Trusted Collabora origin, optionally with a service path, used for discovery and editor launch |
| `FOREMANHQ_PUBLIC_URL` | Canonical externally reachable ForemanHQ origin, without a path, query or fragment |
| `DOCUMENT_EDITOR_SECRET` | Random secret of at least 32 bytes for user/file-scoped editor tokens; keep in the server secret store |
| `JOB_DOCUMENT_STORAGE_ROOT` | Persistent private file directory, as described below |

Both services need HTTPS for production. Local HTTP is allowed only for loopback
addresses in a non-production Node environment. Browsers must reach the editor,
and the editor must reach the canonical ForemanHQ WOPI callbacks. Do not substitute
an internal callback hostname while retaining a different public origin: proof
verification includes the exact externally signed URL. Reverse proxies must
support the editor's WebSocket routes, including `/cool/ws` for current releases.
See the [Collabora proxy configuration](https://sdk.collaboraonline.com/docs/installation/Proxy_settings.html).

The deployed pilot uses official `collabora/code:26.04.4.2.1`, pinned to
`sha256:4e983196eb9878f339cc506c38c21f1cc3473bca3d6de883c5de08f9c0cc3a6c`.
That image runs `/usr/bin/coolwsd --use-env-vars` directly as UID 1001 and has no
shell; old recipes that execute a container startup shell script do not apply.
Pin the selected image digest and retain its configuration when recording a
successful deployment. [Pinned image source](https://github.com/CollaboraOnline/online.mirror/blob/cp-26.04.4-2/docker/from-packages/Dockerfile).

[The reproducible pilot setup](../scripts/ops/collabora/README.md) includes a private
configuration/key preparation helper, a named-volume initializer compatible with
rootless Docker, pinned Compose configuration and an HTTPS proxy example. These
examples require an explicit deployment step; generating configuration does not
start or change a service.

The persistent pilot uses `~/.local/share/foremanhq-office` for its Docker data and
configuration, managed by the user systemd units `foremanhq-office-docker` and
`foremanhq-office`. It runs rootless in a bridged container namespace, with 2 GiB
memory, two CPUs and 512 process slots, and publishes only `127.0.0.1:9980`.
Document chroot isolation and seccomp were verified during local runtime testing.
The private configuration and key archive were generated by the preparation
helper, and loading their UID-1001 files into a named volume passed with rootless
Docker.

The public editor origin is `https://office.stellarator.work`, exposed through a
Cloudflare Tunnel; its WOPI application origin is
`https://foremanhq.stellarator.work`. Public HTTPS, WebSocket connection, signed
WOPI document loading and durable save and close acceptance have passed. The public
test verified a matching committed receipt, immutable revision 3 and the exact
edited text in the downloaded DOCX, with no browser errors. This deployment uses
the tunnel, while the repository's Caddy file remains an alternative proxy example.

Configure an exact ForemanHQ WOPI host allowlist on Collabora. Generate a persistent
RSA proof key, mount it at `/etc/coolwsd/proof_key`, and make it readable by the
editor process. The vendor's `coolconfig generate-proof-key` produces a 4096-bit
RSA key; an unencrypted RSA PEM generated outside the image is also suitable.
Discovery must expose a usable `<proof-key>` or all callbacks fail closed.
Keep document-processing isolation and seccomp enabled, and retain the proof key
across restarts. Avoid logging callback query strings because they carry tokens.
[Collabora security guidance](https://www.collaboraonline.com/security/).

CODE is the development/evaluation distribution. Collabora recommends a supported
deployment for production workloads. Its source uses MPL 2.0 and other applicable
component licenses; review the selected build's licenses and deployment terms
when selecting the production service. This pilot does not claim a blanket
commercial licensing entitlement or production support.
[Collabora integration guidance](https://www.collaboraonline.com/integrate-collabora-online/),
[source license](https://github.com/CollaboraOnline/online.mirror/blob/cp-26.04.4-2/COPYING).

### Protocol and save guarantees

The host supplies stable document IDs to Collabora, with `CheckFileInfo`, `GetFile`
and `PutFile` handlers. Every callback verifies both a signed user/file token and
the editor's RSA proof, then checks current organization membership and file
access. Tokens expire after two hours. The host renews them through an authenticated
application request and sends `Reset_Access_Token` to the existing frame, preserving
the editing session. Revoked permissions cannot be bypassed through renewal.

RSA verification checks the signed token, uppercase callback URL and .NET timestamp,
accepts the specified current/old key rotation combinations, and rejects timestamps
outside a 20-minute window. Proof keys come only from the configured service's
bounded discovery response. Reverse-proxy host headers are not trusted.
[WOPI proof specification](https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/online/scenarios/proofkeys).

`PutFile` checks `X-COOL-WOPI-Timestamp` against the current immutable revision inside
the database mutation lock. An outside upload or version restore returns HTTP 409
with `COOLStatusCode: 1010`; missing timestamps and forced-overwrite retries also
fail rather than replace a newer revision. A successful save returns the new
`LastModifiedTime` only after private file storage and metadata persistence finish.
Unchanged bytes do not create an extra revision.

The frame uses a POST form for its access token. Host messages validate both the
frame window and exact editor origin. **`Action_Save_Resp` is not a durable storage
confirmation in this CODE release.** The editor can emit it after its internal
`.uno:Save` result, before the asynchronous WOPI upload finishes. Its notification
flag can then suppress a later storage response. Neither `success: true` nor
`result: "unmodified"` alone proves that ForemanHQ retained the changes.
[Core response forwarding](https://github.com/CollaboraOnline/online.mirror/blob/cp-26.04.4-2/wsd/ClientSession.cpp),
[browser save response](https://github.com/CollaboraOnline/online.mirror/blob/cp-26.04.4-2/browser/src/control/Control.Toolbar.js).

The save protocol registers an authenticated, document-scoped save intent, sends
its unique ID in `Action_Save.Values.ExtendedData`, and waits for an authenticated
host-side receipt.
Collabora includes that ID in `X-COOL-WOPI-ExtendedData` on `PutFile`. The server
records the receipt only in the successful persistence transaction, including
when identical file bytes need no new revision. The host must match the receipt
to the specific request before showing save confirmation or closing the frame.
It requests `DontSaveIfUnmodified: false` so even an unchanged manual save attempts
serialization/upload; an absent receipt remains unconfirmed. A busy editor or
failed upload may prevent the callback, so an early editor acknowledgement cannot
replace this check. [WOPI upload metadata](https://github.com/CollaboraOnline/online.mirror/blob/cp-26.04.4-2/wsd/wopi/WopiStorage.cpp).

Save intents expire after 15 minutes, with at most 256 active records per job.
The requesting user alone can poll a receipt, subject to current document access.
A currently authorized coauthor may perform the signed storage callback, but only
the registered ID for that document completes the receipt. These internal records
are excluded from the document overview, including folder-restricted records.
Unknown or expired metadata never blocks an otherwise valid file save; it simply
cannot confirm the expired request.

After confirmed persistence, close only the current frame with `Action_Close`;
do not use `Close_Session`, which can close other users' sessions. Token renewal
uses `App_TokenExpiring` and `App_TokenExpired` and updates the existing frame.
[Collabora host messaging implementation](https://github.com/CollaboraOnline/online.mirror/blob/cp-26.04.4-2/browser/src/map/handler/Map.WOPI.js),
[token events](https://github.com/CollaboraOnline/online.mirror/blob/cp-26.04.4-2/browser/src/app/Socket.ts).

## Optional Microsoft file links

Use **Link Microsoft file** for a document that already exists in SharePoint or
OneDrive. Open the file in Microsoft, copy its full browser address, and enter that
address with a display name in ForemanHQ. Prefer `.docx` and `.xlsx` for browser
coauthoring. Microsoft opens in a separate tab and supplies its own sign-in,
editing, coauthoring, save status and version history, subject to the file format,
permissions and licensing of that Microsoft environment.

ForemanHQ stores the validated URL and local organizational metadata. It does not
fetch the Microsoft file, verify that it exists, create a Microsoft sharing grant,
receive save callbacks, show actual editor presence or synchronize its bytes.
Uploading a Word/Excel file directly to ForemanHQ uses the configured Collabora
editor. It does not create or synchronize a copy in Microsoft 365.

Folder permissions govern access to the ForemanHQ record and local uploads only.
Microsoft controls access to the external file independently. Removing a member's
ForemanHQ access, recycling the record or locking it does not revoke a Microsoft
sharing link or stop an existing Office editing session. Review the file's sharing
scope in Microsoft when linking it, particularly links that allow anyone with the
link to open it.

Linked Office files cannot be submitted for a ForemanHQ review or transmittal:
their URLs do not identify an immutable Microsoft revision, and ForemanHQ cannot
detect changes made to the external file. Upload an exported file to ForemanHQ
when an approval or transmittal needs a fixed, retained version.

`src/server/documents/office.ts` accepts recognized HTTPS file URLs on a tenant
subdomain of `sharepoint.com` or on `onedrive.live.com`. It rejects non-Microsoft
hosts, URL credentials, custom ports, fragments, OAuth credentials, unknown query
parameters, arbitrary redirect destinations and generic Office viewer URLs. It
also rejects `1drv.ms` short links and OneDrive `authkey` links: open the file and
copy its canonical browser address instead. The supported SharePoint `e` sharing
parameter is preserved; Microsoft still decides what that link permits. URL
validation does not prove content type, ownership, permissions or editability.

## Access and persistence

All reads and writes require the current authenticated account to be approved and
authorized for the job's organization. File and folder mutation access also
depends on the application's document-management permission and the effective
folder role. Viewers may comment on accessible files and act on reviews assigned
to them.
The nearest explicit folder permission list overrides inherited permissions; an
empty list inherits. Organization managers retain administrative access. These
rules are enforced by the server, including file downloads and history access.

Workspace metadata is stored in PostgreSQL as a job-scoped JSONB state. Uploaded
file bytes are stored privately, outside `public/`, with immutable content keys.
Set `JOB_DOCUMENT_STORAGE_ROOT` to a persistent private directory; by default it is
`uploads/job-documents` relative to the application's working directory. Paths
include the organization ID, hash prefix and SHA-256 content hash.
Keep the database and private upload directory together in backups. This storage
requires a persistent Node filesystem; multiple application instances need shared
storage. It is not a ready-to-deploy ephemeral/serverless blob-storage design.

Uploads are limited to 50 MiB each. Workspace metadata is bounded to 12 MiB, with
limits on documents, folders, versions, comments, activity and workflow records.
Manual uploads have a 200-revision daily limit per member and job; changed editor
saves allow up to 2,000 per day. Both are subject to the 2 GiB daily byte limit and
workspace bounds. Limits are enforced on the server and are not an archive/retention
policy.

The Collabora WOPI host is not an approved Microsoft Office integration. Embedding
Microsoft's own editors would require its Cloud Storage Partner Program and the
additional protocol operations and production validation required by that program.
No Microsoft OAuth/storage integration, credentials, tenant resources or external
sharing grants are created by this change.
[Microsoft CSPP requirements](https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/online/overview).

## Verification

Apply `drizzle/0049_job_documents.sql` to the deployment database using the scoped
migration helper, then build and restart the Node application:

```sh
node scripts/ops/apply-job-documents-migration.mjs
```

The helper's `--rollback-empty` option refuses rollback if any workspace records
exist. Normal application startup does not apply this migration. Configure and
back up private file storage before accepting uploads.

The API routes are `/api/job-documents?jobId=…` for the workspace and actions,
`/api/job-documents/upload?jobId=…` for uploads, and
`/api/job-documents/files/{versionId}?jobId=…` for authorized file reads. Add
`download=1` to request attachment download. These responses are private and are
not cached for offline use.

Editor launch and token renewal use `POST /api/job-documents/editor`; new DOCX/XLSX
files use `POST /api/job-documents/editor/new`. WOPI callbacks use
`/api/job-documents/wopi/{documentId}?jobId=…` and its `/contents` child. The editor
status endpoint indicates configuration only, not successful live editing.
`POST /api/job-documents/editor/save` registers a save intent, and an authenticated
`GET` to the same route polls its persistence receipt. Both are normal application
endpoints; neither uses the WOPI callback authentication exemption.

Run document and editor tests:

```sh
pnpm exec vitest run src/server/documents src/app/api/job-documents src/components/jobs/documents/DocumentEditor.test.tsx src/components/jobs/JobDocumentsView.test.tsx
```

Proof verification has 32 passing signed-RSA tests, including token/URL tampering,
timestamps, key rotation and unsafe discovery. The full application test suite has
1,041 passing tests and 17 skipped tests, including the storage receipt changes.
TypeScript checking and the deployed production build also passed.

Live local acceptance results recorded on October 7, 2026:

| Check | Verified result |
| --- | --- |
| Word | Typed DOCX content saved as immutable revision 2; downloaded file contained the exact text |
| Excel | Entered `1250` and `750`, with `SUM(A1:A2)`; downloaded XLSX retained the formula and calculated result `2000` |
| Coauthoring | Two distinct users opened the same WOPI document and edited together; the downloaded DOCX retained both users' text, and closing one editor left the other session open |
| Mobile | At 390 × 844, DOCX typing, revision-2 persistence, save and close, and explicit discard confirmation passed with no JavaScript errors or horizontal overflow |
| Callback security | All 15 signed HTTP security checks passed against the running integration |

Public acceptance also passed against deployed commit `4873490`, build
`q8pIyYtZX6UVA1NuCJKT6`: HTTPS, WebSocket and signed WOPI loading succeeded, the
matching storage receipt was committed before close, and the downloaded immutable
revision 3 contained the exact edited DOCX text. No browser errors were recorded.
These results establish the tested file contents and workflows; continue to assess
longer sessions and token renewal, representative customer documents,
revoked/read-only access, outside-upload conflicts, outage recovery and workload
capacity before a supported production rollout.

The Office URL tests use synthetic URLs and never contact Microsoft:

```sh
pnpm exec vitest run src/server/documents/office.test.ts
```

They cover supported document-link shapes, URL normalization, deceptive hostnames,
credentials, auth tokens, redirect parameters, malformed input and non-file links.
Passing these tests is not evidence of a live Microsoft editing session. Optional
acceptance testing needs two authorized Microsoft accounts opening the same test
document, observing concurrent edits and AutoSave, verifying persistence on reopen,
and checking denied/revoked access with an unauthorized account.

The BIM 360 comparison above follows Autodesk's
[Document Management workflow](https://help.autodesk.com/cloudhelp/ENU/BIM360D-Document-Management/files/To-Work-with-Document-Management/GUID-B84FB661-07A5-4576-A8AD-3D8B6F5C3DBB.html),
[file operations](https://help.autodesk.com/cloudhelp/ENU/BIM360D-Document-Management/files/To-Work-with-Document-Management/GUID-EB7E6ED7-0787-4B9D-80E3-6BDF3F3A8812.html),
[transmittals](https://help.autodesk.com/cloudhelp/ENU/BIM360D-Document-Management/files/BIM360D_Document_Management_about_transmittals_html.html),
and [Microsoft 365 support](https://help.autodesk.com/cloudhelp/ENU/BIM360D-Document-Management/files/To-Work-with-Document-Management/To-Work-with-Documents/BIM360D_Document_Management_To_Work_with_Document_Management_To_Work_with_Documents_to_work_office_html.html).
Integration references were checked on October 7, 2026.
