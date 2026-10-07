# Job documents

The **Documents** card in a job opens the document workspace for that job. This
implementation supplies document management and links to existing Microsoft files.
It is a foundation for BIM 360-style workflows; it does not provide full BIM 360
Document Management parity or an embedded Microsoft Office editor.

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
| Word and Excel | Open an existing, linked Microsoft file in Microsoft 365 in a new tab | Automatic upload/sync, integrated identity, provider version capture and embedded coauthoring |
| Field access | Responsive online workspace | Offline document downloads, synchronization and conflict handling |

Transmittal creation records a package; its JSON manifest records the selected
document revisions without including the file bytes. It does not send email or
notify the listed recipients. The activity feed is application history, not a
tamper-evident or regulatory audit archive.

## Word and Excel: what works now

Use **Link Microsoft file** for a document that already exists in SharePoint or
OneDrive. Open the file in Microsoft, copy its full browser address, and enter that
address with a display name in ForemanHQ. Prefer `.docx` and `.xlsx` for browser
coauthoring. Microsoft opens in a separate tab and supplies its own sign-in,
editing, coauthoring, save status and version history, subject to the file format,
permissions and licensing of that Microsoft environment.

ForemanHQ stores the validated URL and local organizational metadata. It does not
fetch the Microsoft file, verify that it exists, create a Microsoft sharing grant,
receive save callbacks, show actual editor presence or synchronize its bytes.
Uploading a Word/Excel file directly to ForemanHQ does not make it editable in
Microsoft 365. Link the Microsoft-hosted file separately to use Office editing.

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
Limits are enforced on the server and are not an archive/retention policy.

## Completing genuine Office integration

There are two supported Microsoft architectures to evaluate. Neither is enabled
merely by entering an environment variable or displaying an iframe.

### Microsoft-hosted storage with Graph

Use an existing SharePoint/OneDrive library or provision SharePoint Embedded
containers, register the application in Microsoft Entra ID, obtain the appropriate
Microsoft Graph consent, and map each ForemanHQ document to an actual drive item.
Store tokens server-side with suitable access controls and lifecycle handling.
For SharePoint Embedded, the Graph permission and container-type permission layers
are both required; registration and Azure billing must also be configured.
[Microsoft authentication and authorization documentation](https://learn.microsoft.com/en-us/sharepoint/dev/embedded/build/configure-authentication-authorization).

After provisioning files and access, use the drive item's `webUrl` to launch Office
editing. Implement permission synchronization deliberately, handle revoked access,
and reconcile provider versions and changes before claiming ForemanHQ history or
reviews capture live Office edits. Microsoft documents coauthoring, AutoSave and
version history for this flow. SharePoint Embedded's editing surface opens in
another tab; its inline iframe experience is read-only preview.
[Microsoft Office launch documentation](https://learn.microsoft.com/en-us/sharepoint/dev/embedded/build/open-office-files),
[editing versus embedded preview](https://learn.microsoft.com/en-us/sharepoint/dev/embedded/plan/office-collaboration-instead-of-building).

SharePoint Embedded setup requires a Microsoft 365 tenant with at least one
SharePoint license, an administrator, Entra users/guests, container registration
and billing arrangements. Its document collaboration generally does not require
each user to hold an Office license, but specific experiences such as mentions
have exceptions. Confirm the chosen storage and licensing model before rollout.
[Customer tenant setup](https://learn.microsoft.com/en-us/sharepoint/dev/embedded/publish/customer-tenant-setup-guide).

### Embedded Microsoft Office against ForemanHQ storage

For Office editors embedded in ForemanHQ while files remain in ForemanHQ's cloud
storage, apply to Microsoft's Cloud Storage Partner Program (CSPP). The program
reviews qualifying SaaS storage vendors individually. It requires integration for
Word, Excel and PowerPoint upload, download, viewing and editing, even when only a
subset is exposed in the product. Editing users need the appropriate Microsoft
365 licenses. [CSPP eligibility and integration requirements](https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/online/overview).

Implement a WOPI host with stable file IDs, version identifiers, user/file-scoped
tokens, discovery, a host page, proof-key validation, HTTPS and concurrent-write
protection. Editing needs `CheckFileInfo`, `GetFile`, `PutFile`, `PutRelativeFile`,
`Lock`, `Unlock`, `UnlockAndRelock` and `RefreshLock`. Complete Microsoft's testing
and production launch process before exposing it as available.
[Required WOPI operations](https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/online/wopi-requirements),
[test and production environments](https://learn.microsoft.com/en-us/microsoft-365/cloud-storage-partner-program/online/build-test-ship/environments).

The current module implements neither WOPI nor Graph OAuth/storage integration.
No Microsoft credentials, tenant resources or external sharing grants are created
by this change.

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

The Office URL tests use synthetic URLs and never contact Microsoft:

```sh
pnpm exec vitest run src/server/documents/office.test.ts
```

They cover supported document-link shapes, URL normalization, deceptive hostnames,
credentials, auth tokens, redirect parameters, malformed input and non-file links.
Passing these tests is not evidence of a live Microsoft editing session. Live
acceptance testing needs two authorized Microsoft accounts opening the same test
document, observing concurrent edits and AutoSave, verifying persistence on reopen,
and checking denied/revoked access with an unauthorized account.

The BIM 360 comparison above follows Autodesk's
[Document Management workflow](https://help.autodesk.com/cloudhelp/ENU/BIM360D-Document-Management/files/To-Work-with-Document-Management/GUID-B84FB661-07A5-4576-A8AD-3D8B6F5C3DBB.html),
[file operations](https://help.autodesk.com/cloudhelp/ENU/BIM360D-Document-Management/files/To-Work-with-Document-Management/GUID-EB7E6ED7-0787-4B9D-80E3-6BDF3F3A8812.html),
[transmittals](https://help.autodesk.com/cloudhelp/ENU/BIM360D-Document-Management/files/BIM360D_Document_Management_about_transmittals_html.html),
and [Microsoft 365 support](https://help.autodesk.com/cloudhelp/ENU/BIM360D-Document-Management/files/To-Work-with-Document-Management/To-Work-with-Documents/BIM360D_Document_Management_To_Work_with_Document_Management_To_Work_with_Documents_to_work_office_html.html).
Integration references were checked on October 7, 2026.
