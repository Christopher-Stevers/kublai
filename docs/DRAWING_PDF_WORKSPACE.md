# PDF drawing workspace

Scope: Tim selected PDF drawing tools first on 2026-10-07. Native DWG, Revit and 3D model tooling is outside this release. This is an implementation of the documented PDF drawing workflows in ForemanHQ, not a claim of complete Autodesk product equivalence.

## Workflow coverage

| Workflow | ForemanHQ implementation |
| --- | --- |
| Drawing register | Existing PDF upload/page splitting and drawing folders; grid/list, natural sheet-number order, title/discipline/tags/status, search, favorites. Title-block extraction reads embedded text or explicitly requested local Tesseract OCR. Batch suggestions are editable before saving. |
| Fast viewing | Persistent vector PDF canvas with bounded decoded image tiles; pan, pinch, double tap, one-finger quick zoom, fit, adjacent-page preload. Tools extend the existing viewer. |
| Markups | Pen, highlighter, text, callout, rectangle, ellipse, line, arrow, polyline, rectangular/polygon revision clouds, dimension, area, angle, count and sheet/web links. Color, width, fill, opacity; selection and point editing; finish/undo/cancel for multi-point drafts. |
| Collaboration | Private drafts, published team markups, visibility filters, comments, attributed activity, per-entity optimistic concurrency checks and soft archive. Private entities remain private even from drawing managers. |
| Issues / RFIs | Sheet-position pins, descriptions, assignee, due date, status, comments, secure photo/PDF attachments and links to job documents. Assignment and sheet-watch notifications use the existing opt-in device push system and an in-app inbox. |
| Measurement | Existing sheet calibration plus saved dimensions, area, angles and counts. Calibration is reset when the current source revision changes. These are drawing-scale measurements, not survey measurements. |
| Navigation | Saved named views, private/published views, deep links, imported PDF hyperlinks and reviewed suggestions for references to other uploaded sheet numbers. |
| Revisions | Attach an already uploaded sheet as an immutable revision; history, view earlier versions, restore current version. Markups remain tied to their source sheet. Version references protect source sheets/folders from deletion. |
| Comparison | Side-by-side, overlay, difference and wipe comparison. Manual offset and scale alignment. |
| Review | Named reviewer requests and immutable approval/change-request responses to a specific revision. Decisions validate the request, reviewer and current revision. |
| Transmittals | Attributed, immutable package record with selected source-sheet snapshots, recipient description, notes and multi-sheet PDF download. Creating a record does not send an email or grant external access. |
| Export | Original PDF, vector-preserving individual-sheet PDF with ForemanHQ markups, print and bounded multi-sheet PDF packages. Source crop boxes, rotations and PDF UserUnit handling are verified by native rendering tests. |
| Offline | Explicit account-scoped bounded downloads of source PDFs, previews, optional detail tiles and workspace metadata. Private markup/issue drafts synchronize with expected revisions; conflicts remain visible rather than overwriting server edits. Account changes revoke downloads, parsed PDF documents, text caches and drawing query caches. |

## Operational boundaries

- Server API authorization is based on current approved organization membership and dashboard/drawing permissions. This release does not add a separate folder-specific drawing ACL system. The Documents workspace has its own permissions; linked document URLs keep those permissions.
- Reviews are independent named-reviewer requests and responses, not a configurable multi-stage contractual approval/signature service.
- Notifications are opt-in web push. They need an enabled device subscription and configured VAPID keys. The development tests mock delivery; they do not send messages to real users.
- PDF title recognition and reference suggestions require review. They do not infer authoritative sheet identities from uncertain OCR.
- Offline drafting covers private own markups and issues. Publishing, attachments, approvals, revision changes and comments require a connection. The app must have been opened while signed in; a fresh offline server-rendered login session is not provided.
- The original PDF download preserves all original content. A newly exported single-sheet PDF preserves original vector page content plus ForemanHQ markups, but does not reproduce every interactive PDF form or original annotation appearance.
- Transmittals record the exact selected source sheets; they do not imply email delivery, electronic signature, public sharing, or an Autodesk integration.
- Uploading a revision never guesses which existing drawing it should replace. The user chooses the corresponding sheet explicitly.
- Local drawing attachments are backed up with the existing uploads backup. Unreferenced attachments are retained; no automatic deletion policy is introduced here.

## Data and deployment

`drizzle/0050_drawing_workspace.sql` adds drawing entities, metadata, favorites, watch preferences, activity, notifications and a durable push outbox. Apply it with `scripts/ops/apply-drawing-workspace-migration.mjs` after a database backup. The change is additive; existing sheets, room detection and material-list data are not rewritten.

Mutation inputs carry expected revisions. Offline writes also carry the expected authenticated user ID. Published mutations enqueue notifications within the same database transaction; workers claim device deliveries, recheck current permissions/assignment/watch state and retry transient failures with limits. Archived/private content is not exposed through generic push payloads.

`uploads/drawing-attachments/<job>/<uuid>/` contains immutable attachment bytes and metadata. Uploads are bounded, photos are decoded/re-encoded, PDFs are served as attachments, and downloads require current authorization plus uploader/visible-issue access.

## Evidence

- `scripts/check-drawing-workspace-db.ts` exercises a disposable PostgreSQL database: tenancy, private visibility, permission revocation, concurrent edit conflicts, versions, review ownership, deletion guards and mocked notification delivery/retries.
- Drawing component tests exercise persistence inputs, selection, gesture coexistence, search/filtering, explicit title-block review, exported content and offline account boundaries.
- `src/lib/drawing-pdf-export.node-test.ts` renders exported PDFs with native canvas and checks original geometry and markup location across all right-angle rotations, crop boxes and UserUnit values.
- Browser automation was unavailable in this task (no connected browser surfaces). Automated DOM/pointer and native PDF tests are not a substitute for an actual phone FPS/touch usability measurement.

## Autodesk references checked for the feature map

- [Markup tools](https://help.autodesk.com/cloudhelp/ENU/BIM360D-Document-Management/files/To-Work-with-Document-Management/About-Markups/BIM360D_Document_Management_To_Work_with_Document_Management_About_Markups_to_use_the_markup_toolbar_html.html)
- [2D comparison](https://help.autodesk.com/cloudhelp/ENU/BIM360D-Document-Management/files/About-Comparing-2D-and-3D/GUID-08779B83-961E-4A6A-AC33-BC4B2DD0BCF7.html)
- [Android drawing workflows](https://help.autodesk.com/cloudhelp/ENU/BIM360D-Mobile-Apps/files/About-the-BIM-360-Android-Mobile/GUID-ACC837CF-68F1-4EBC-8AD4-44F58AFC67DF.html)
- [Plans and Project Files capabilities](https://help.autodesk.com/cloudhelp/ENU/BIM360D-Document-Management/files/To-Work-with-Document-Management/GUID-9B58CB2C-0519-47B0-9199-4535577B594A.html)
- [Title-block recognition](https://help.autodesk.com/cloudhelp/ENU/BIM360D-Document-Management/files/To-Work-with-Document-Management/About-Uploading-and-Publishing/GUID-C77CA0AB-5A9D-4364-8920-274A597DF12E.html)
- [Document operations](https://help.autodesk.com/cloudhelp/ENU/BIM360D-Document-Management/files/To-Work-with-Document-Management/GUID-EB7E6ED7-0787-4B9D-80E3-6BDF3F3A8812.html)
