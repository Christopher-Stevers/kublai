# Construction model workspace

Open a job, then **Models**. This workspace uses the existing drawing view/upload/delete permissions; viewers may save personal views and create collaborative issues. Company settings plus drawing upload permission are required to configure Autodesk. Every server entry point rechecks approved membership and organization/job access.

## Shipped workflow

- Revit (.rvt) source registration and immutable revisions, with explicit Autodesk conversion.
- Direct IFC import through a web-ifc worker; Three.js batched rendering. Shared coordinates are preserved across trade models. Geometry is normalized to metres and rebased near the camera for precision.
- Orbit/pan/zoom, orientation presets, orthographic top view, free navigation, element selection/properties, category/level filters, hide/isolate, x-ray, section planes and selection boxes.
- Distance and planar area measurements with nearby triangle vertex snapping. Saved views retain exact model revision IDs, camera, clipping, visibility and measurements.
- Located coordination/RFI/punch/safety issues, assignment, priority, due date, status and comments. Optimistic revisions prevent lost edits. Assignees may update status; authors/model managers may edit details.
- Element CSV, issue CSV, BCF 2.1 camera/selection viewpoints and PNG snapshots. CSV text is protected against formula injection. BCF does not contain model geometry or FormanHQ measurements/visibility filters.

## Autodesk setup

**Models → Set up Revit conversion** explains APS and accepts the company's client ID and secret. Create a server-to-server application in the [Autodesk developer portal](https://aps.autodesk.com/myapps) with Data Management and Model Derivative access. The account requires appropriate APS service entitlement; Autodesk usage charges are separate. FormanHQ verifies OAuth credentials when connecting. Only choosing **Convert with Autodesk** sends the uploaded Revit file to Autodesk.

The server uploads the original through signed multipart S3 URLs, requests RVT-to-IFC translation, polls the manifest, and stores the derivative locally. Tokens and signed URLs are never returned to the browser. Each organization gets a separate bucket. A durable database queue processes one model at a time, with leases, restart recovery and explicit retry after failure. A failed response after submission can require another translation on retry; check Autodesk usage for such failures.

Revit conversion requires this external account and could not be verified against a live Autodesk account during implementation. HTTP contract tests simulate Autodesk. Direct IFC rendering and persistence were tested with synthetic construction geometry and a real PostgreSQL test schema.

References: [RVT/IFC translation](https://aps.autodesk.com/en/docs/model-derivative/v2/developers_guide/supported-translations/ifc-file-translations/), [multipart upload](https://aps.autodesk.com/blog/direct-s3-nodejs-samples), [APS pricing](https://aps.autodesk.com/pricing).

## Deployment and storage

Apply `drizzle/0067_bim_workspace.sql` transactionally and record its journal hash before starting the new server. `src/instrumentation.ts` starts the conversion dispatcher. Set `BIM_WORKER_DISABLED=1` for previews or test servers sharing the production database.

Models, upload chunks and encrypted per-company Autodesk connections are under `uploads/bim`, or `BIM_STORAGE_ROOT`. Back up this entire directory **including `.credentials-key`**, alongside the database. The AES-256-GCM key is generated privately and durably on first connection; an optional `BIM_CREDENTIALS_KEY` can supply a base64 32-byte key instead. Preserve the key across restores and releases. Never rotate it independently of re-encrypting stored connections. All model files are content addressed and scoped to the organization; archived revisions remain available to existing viewpoints.

Optional environment-based APS credentials are accepted only when all three are set: `APS_ORGANIZATION_ID`, `APS_CLIENT_ID`, and `APS_CLIENT_SECRET`. The organization ID binding prevents credentials from being used by unrelated tenants. A saved per-company connection takes precedence.

Uploads use 8 MB chunks, maximum 250 MB per source/derivative. Unfinished upload sessions expire after 24 hours; expired sessions are removed when another upload starts for that company. Eight unfinished sessions per uploader are allowed. Worker geometry limits are 6 million vertices per model and 12 million per open scene. Large Revit/IFC projects should be split by trade or floor, especially for phones.

## Boundaries

This is a construction coordination viewer, not a Revit authoring replacement. It does not edit RVT, resolve embedded Revit links, display Revit sheets, run automatic clash detection, compute cost takeoffs, provide collision/ground physics, or cache models for offline access. Linked files must be uploaded separately with matching coordinates or supplied as a federated IFC export. IFC conversion may omit Revit-only details; validate the exported model and scale before field layout. Full drawing annotation workflows remain in Drawings.

The synthetic `src/lib/bim/fixtures/construction.ifc` is a test fixture, not project data. It includes millimetre units, large world offsets, two levels, walls/columns/beams/ducts and a wall property set to exercise geometry, coordinates and metadata.
