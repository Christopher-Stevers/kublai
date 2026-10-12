# Construction model workspace

Open a job, then **Models**. This workspace uses the existing drawing view/upload/delete permissions; viewers may save personal views and create collaborative issues. Every server entry point rechecks approved membership and organization/job access.

## Shipped workflow

**Controls** in the viewer footer opens navigation settings. First-person, Orbit/CAD, trackpad and left-handed presets can be customized with primary/alternate keys, six mouse/Shift-drag assignments, horizontal or camera-directed travel, speed multipliers, sensitivity and direction inversion. Settings apply to every model tool and are stored per account on the current device; disabled browser storage falls back to session-only settings. Keyboard navigation requires canvas focus, stops on blur or opening Controls, and leaves browser shortcuts alone. Touch retains pinch zoom and two-finger pan. Reset defaults restores the original first-person bindings.

- Revit (.rvt) source registration and immutable revisions, with local conversion and automatic version detection. No Autodesk account is needed. Native geometry is an experimental preview; IFC retains the construction workflow.
- Direct IFC import through a web-ifc worker; Three.js batched rendering. Shared coordinates are preserved across trade models. Geometry is normalized to metres and rebased near the camera for precision.
- Orbit/pan/zoom, orientation presets, orthographic top view, free navigation, element selection/properties, category/level filters, hide/isolate, x-ray, section planes and selection boxes.
- Distance and planar area measurements with nearby triangle vertex snapping. Saved views retain exact model revision IDs, camera, clipping, visibility and measurements.
- Located coordination/RFI/punch/safety issues, assignment, priority, due date, status and comments. Optimistic revisions prevent lost edits. Assignees may update status; authors/model managers may edit details.
- Element CSV, issue CSV, BCF 2.1 camera/selection viewpoints and PNG snapshots. CSV text is protected against formula injection. BCF does not contain model geometry or FormanHQ measurements/visibility filters.

## Local Revit converter

Choose **Prepare local preview** after uploading an RVT. `native/revit` is FormanHQ’s Rust conversion executable, built on the pinned Apache-2.0 [rvt-rs reader](https://github.com/DrunkOnJava/rvt-rs/tree/120e2f9ffa8422ba437102c8d300b7e902cdde80). Its license and notice are retained in `native/revit/licenses`. This is our conversion service and policy layer using an open-source format decoder, not an independently authored decoder for every RVT record.

The executable detects the version from `BasicFileInfo`; geometry currently targets 2024–2026. Other versions get an unsupported report and retain their original file. It tries recovered geometry and saved display meshes, removes unresolved bounding-box substitute bodies (including their host cuts), and writes IFC4 plus a versioned report. Element counts describe recovered elements, not source completeness. It does not silently manufacture missing geometry or contact a cloud converter.

Every native preview is marked experimental. Measurements, combining models and issuing it for construction are blocked in both the UI and persisted-view/publication APIs. Native conversion uses internal Revit coordinates; shared survey coordinates and linked files remain unresolved. Normal IFC imports keep their existing measurement/federation behavior. Saved inspection views, selection, properties, clipping, filters and located issues work on previews.

The existing database queue processes one model at a time, rechecks the requester's permission before and after conversion, and stores derivatives in organization-scoped content-addressed storage. Linux Bubblewrap runs the executable with no network, credentials or home directory, a read-only input/runtime, private temporary output, 4 GiB address space, 240 CPU seconds, 300 seconds wall time, 250 MiB output-file limit and no core dumps. Unavailable isolation fails closed. Temporary outputs are removed on completion or failure. Converter/parser limits also bound input files, streams and decompression.

Build and check before deploying:

```sh
cargo test --locked --manifest-path native/revit/Cargo.toml
cargo clippy --locked --manifest-path native/revit/Cargo.toml --all-targets -- -D warnings
cargo build --release --locked --manifest-path native/revit/Cargo.toml
pnpm exec tsx scripts/ops/check-native-revit.ts
```

The last command fetches three public, hash-pinned RVT/reference-IFC pairs into `.tmp/native-revit-validation`, exercises the real sandbox and compares element IDs, GUIDs and bounding dimensions/positions. It does not upload models. It needs network access only to acquire the public test inputs. The results are a regression check, **not a construction-accuracy certification**: matching bounding boxes does not establish matching surfaces, openings or complete properties.

Validation on 2026-10-11: Core Interior (2024) recovered 970 bodies including 116 spaces; all 854 visible reference elements matched IDs, GUIDs and axis-aligned bounds within 5 mm. RE1 Mechanical (2025) recovered 74 visible bodies with all 74 matching the same checks. RE1 Architecture (2025) had 71/72 visible reference elements, with 62/71 matching bounds within 5 mm; some furniture differed by about 0.503 m, and two unresolved bodies were omitted. Those known gaps are why measurements remain disabled. Synthetic invalid/future-version checks and a real PostgreSQL test schema exercise failures, tenant isolation, queue exclusivity and preview restrictions. Browser checks use actual converted mechanical geometry and the production IFC worker at 1440, 390 and 320 pixels.

## Deployment and storage

Apply `drizzle/0067_bim_workspace.sql` transactionally and record its journal hash before starting the new server. `src/instrumentation.ts` starts the conversion dispatcher. Set `BIM_WORKER_DISABLED=1` for previews or test servers sharing the production database. Install Linux `bwrap` and `prlimit`; the native binary defaults to `native/revit/target/release/foreman-revit` under the server working directory, or set an absolute `BIM_NATIVE_CONVERTER_PATH`. Deploy this binary alongside the web build. No new migration is needed for native reports; they live in the existing model JSON.

Models, upload chunks and encrypted per-company Autodesk connections are under `uploads/bim`, or `BIM_STORAGE_ROOT`. Back up this entire directory **including `.credentials-key`**, alongside the database. The AES-256-GCM key is generated privately and durably on first connection; an optional `BIM_CREDENTIALS_KEY` can supply a base64 32-byte key instead. Preserve the key across restores and releases. Never rotate it independently of re-encrypting stored connections. All model files are content addressed and scoped to the organization; archived revisions remain available to existing viewpoints.

Legacy Autodesk connection code and existing encrypted credentials are retained for compatibility; the local conversion worker does not use or transmit them. The former APS integration accepted: `APS_ORGANIZATION_ID`, `APS_CLIENT_ID`, and `APS_CLIENT_SECRET`. Do not delete existing credentials from backups during this transition.

Uploads use 8 MB chunks, maximum 250 MB per source/derivative. Unfinished upload sessions expire after 24 hours; expired sessions are removed when another upload starts for that company. Eight unfinished sessions per uploader are allowed. The viewer no longer rejects models at 6 million vertices or federated scenes at 12 million vertices. It indexes repeated position/normal pairs, keeps exact Float32 triangle positions, packs unit normals into normalized Int16 attributes, and reuses geometry for repeated placements within a render batch. This changes shading-normal precision by less than 0.003 degrees; measurement coordinates and triangle winding are unchanged.

The worker reads one IFC element at a time and transfers chunks after about 2 MiB, 96 placements, or 40 ms of processing (a single component can exceed the chunk target). It waits for the viewer to consume each chunk before continuing. Geometry renders progressively, and removing a loading model cancels its download or the next geometry step and frees its resources. The initial synchronous IFC parse and individual tessellations cannot be interrupted mid-call. The browser's `GetFlatMesh` API is used because web-ifc 0.0.78's `StreamMeshes` wrapper and browser WASM disagree on the argument count.

When opened as an installed standalone web app, the viewer keeps one persistent IFC file (including the locally converted IFC for Revit previews) in IndexedDB per browser profile. Ordinary browser tabs always download and do not read, update, or delete this slot. The installed app requests persistent storage once per page session; browser approval is not guaranteed. Reopening that file checks authorization and its content hash with a HEAD request, then reads saved bytes without downloading the body. Switching files or content versions replaces the single slot; a transaction token prevents an older tab from saving over a newer selection. Multiple models can still be viewed together, but only the most recently loaded file is retained on disk. Downloads checkpoint their received bytes in atomic IndexedDB transactions after approximately 1 MiB, and flush smaller pending chunks on connection errors or cancellation. Reopening an interrupted download checks access, file size and the content hash, then requests the remaining bytes with Range and If-Range. A changed version starts a fresh download; a full response from a server that ignores Range replaces the partial bytes instead of duplicating them. Completed downloads remain reusable even if the app closes before parsing finishes. Parsing and geometry generation still run when reopening. Offline access is not enabled: the access check requires a connection. Browser storage clearing, eviction, private mode, or quota limits can require another download; storage failure does not block viewing.

Device memory remains finite. The scene budgets estimated CPU and GPU geometry storage together: 256 MiB on devices reporting at most 2 GiB RAM, 384 MiB on touch devices or those reporting at most 4 GiB, and 768 MiB otherwise. These estimates are not measurements of free RAM and exclude parser/browser overhead. If the budget is exhausted, the viewer explains that other models must be closed or a smaller export used; it does not silently drop elements.

To compare a real IFC against the original reader without uploading or changing app data:

```sh
pnpm exec tsx scripts/ops/check-model-streaming.ts path/to/model.ifc report.json
pnpm exec vitest run src/lib/bim/streaming.test.ts src/lib/bim/geometry.test.ts
```

Validation on 2026-10-11 used the 112,450,900-byte converted Snowdon IFC (SHA-256 `a542b0a6c7cd6dbcfbd4aa7b9a455d8e2ceb00310b2e7621854e971671cf5531`). All 5,238 visible elements and 2,511,042 triangles match the original reader, including exact triangle positions and placement transforms. Geometry payloads decreased from 209,853,912 to 122,305,266 bytes (41.72%). Chromium checks at 390- and 1440-pixel viewport widths also cover orbiting, selection/properties, filtering, measurement, restoring a view, canceling a partial load and replacing it, and a failed download. These are desktop browser checks, not tests on a physical phone. This verifies the viewer, not the completeness of the experimental RVT conversion.

## Boundaries

This is a construction coordination viewer, not a Revit authoring replacement. It does not edit RVT, resolve embedded Revit links, display Revit sheets, run automatic clash detection, compute cost takeoffs, provide collision/ground physics, or cache models for offline access. Linked files must be uploaded separately with matching coordinates or supplied as a federated IFC export. IFC conversion may omit Revit-only details; validate the exported model and scale before field layout. Full drawing annotation workflows remain in Drawings.

The synthetic `src/lib/bim/fixtures/construction.ifc` is a test fixture, not project data. It includes millimetre units, large world offsets, two levels, walls/columns/beams/ducts and a wall property set to exercise geometry, coordinates and metadata.

### Two-thumb navigation

Controls → Touch assigns each thumb independently: steer/look, fly forward/backward, travel with strafe, elevation with strafe, orbit, screen-plane pan, zoom, or disabled. Six presets include Steer & fly, Game controller, and left-handed flight. Pads appear on touch devices and in Walk by default, with Always/Off options. Pad size, touch steering sensitivity, vertical inversion, and movement speed are adjustable. Pads have an analog dead zone; both thumbs can operate simultaneously, and releasing/canceling a pointer, losing focus, hiding the page, changing tools, or opening navigation settings stops input. Existing saved keyboard/mouse configurations migrate with touch defaults.

Floating joysticks use each touch-down location as the neutral center on its half of the canvas. Show joystick graphics only affects rendering, never input; both controls can operate invisibly. Graphics exist only while touching. A short stationary single touch retains selection/measurement placement. With touch controls off, native pinch/pan gestures remain available.

### CAD editing

Models → Edit opens the CAD workspace for an uploaded IFC. Models → New CAD design creates an empty, valid IFC project and opens the editor without needing an upload. Editing requires drawing upload permission; removing saved objects or source elements additionally requires drawing delete permission. Native experimental Revit previews cannot be edited.

Top, front, right and 3D views edit the same design. Desktop opens four panes; phones open a single pane with view tabs and an optional four-view layout. Each pane has its own camera, zoom and pan. The renderer shares source geometry across panes, following the [Three.js scissored-view approach](https://threejs.org/manual/pages/cameras.html). Orthographic views keep their axes fixed. Middle mouse always pans, including during drafting; on touch, drag navigates and two fingers pan/pinch. Properties dock alongside the views on desktop and in a collapsible bottom panel on phones. Save and Close remain visible on narrow screens.

Available tools:

- Pipes, ducts, elbows, tees, valves, pumps, tanks, equipment, walls, slabs and boxes. Pipe/duct/wall tools accept start and end points; At view places a default element at the camera target. Continue drawing keeps the tool active and chains pipe/duct segments.
- Lines, polylines, rectangles and circles, with rubber-band previews and editable local vertices. Finish ends a polyline; Close shape connects it to its first point. Flat outlines can be extruded, with an editable depth.
- Grid, endpoint, midpoint, centre/corner and imported-triangle vertex snapping. Snapping has a fixed screen-pixel tolerance. A cached screen-space grid indexes design anchors; geometry updates rebuild only objects whose data changed. Workplanes are initialized in the source model's world coordinate system. Top uses XZ, front XY and right YZ; 3D supports a chosen plane or surface placement. Angle constraints use the workplane axes, with free, 45° and 90° options and an exact segment length.
- Move/rotate handles, numeric position/rotation/dimensions, metric or decimal imperial units, selection across views, Shift-click or touch multiselect, duplication, evenly spaced arrays, undo/redo, colour and system/material/notes.
- Named layers with visibility and selection locks. The selected layer owns newly created objects; existing objects can move between layers. Locking is an editing aid, not an access-control boundary.
- Download/import of a versioned `.fhcad.json` document preserving geometry, properties, layers and imported-element overrides. Imports with source overrides must target the same model. DXF exports sketch outlines and straight pipe/duct centrelines, in metres with CAD Z-up coordinates, using [3D POLYLINE entities](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-DXF/files/GUID-ABF6B778-BE20-4B49-9B58-A94E64CEFFF3.htm). DXF does not contain solid bodies or the imported source model.

Shortcuts: V select, P pipe, L line, R rectangle, C circle, F fit, 1–4 views, Enter finish, Escape cancel, Delete remove, Ctrl/Cmd D duplicate, Ctrl/Cmd Z undo, Ctrl/Cmd Shift Z redo, Ctrl/Cmd S save, F8 ortho, F3 object snap. Numeric coordinates remain world metres internally; Y is vertical. Display units do not scale the geometry.

Each model revision has a shared design document. Source uploads are immutable. A job-scoped, permission-checked transaction saves optimistic revisions and a before/after audit entry; stale saves return CONFLICT. Local drafts are scoped to user/job/model and recovered when browser storage is available. Changes become shared after Save design. Creating a blank project uses an idempotent client request ID. No schema migration is needed beyond the existing `0068_bim_design.sql`; the new fields are optional and older designs remain readable. Resource limits are 2,000 design objects, 5,000 source overrides, 100 layers and 50,000 total sketch vertices, with at most 512 vertices per object.

This is a construction CAD editor, not full AutoCAD or Revit parity. It does not read/write DWG, rewrite RVT/IFC, export edited IFC, solve parametric constraints, perform solid Boolean operations, or create connected MEP networks. Equipment/fittings use simplified templates; imported elements can be moved, rotated, removed or restored as a unit, but their original shape is not parametrically editable. Sketch extrusion targets simple planar outlines. Existing engineering details still need appropriate design review.

Validation (2026-10-12): 118 model/CAD tests and seven tests against isolated PostgreSQL. `node scripts/test-cad-browser.mjs` builds the actual workspace and IFC worker with synthetic models and fixture API writes; it checks four-view and mobile drafting, shape extrusion, real transform handles, middle-button pan, undo/redo, layers, file download, blank IFC creation, save/reopen and narrow-screen overflow. Screenshots go to `.tmp/cad-qa`. These are Chromium touch-emulation checks, not physical-device certification. Independent ezdxf validation reads the metre-based 3D DXF with zero errors or repairs. The production build and typecheck pass, and changed CAD/model files pass lint. The repository-wide lint command still reports 91 findings, all reproduced against unchanged HEAD; that existing debt is outside this change.
