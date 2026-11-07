# Material groups

Material selection now supports nested groups, for example PVC → Gasketed SDR → Gasketed DR35. A group is a navigation folder. Selecting a material still uses the original material ID and continues to size/category/part selection. Part definitions, prices, material lists and orders are unchanged.

Use **Catalogue → Material groups** to assign existing materials to groups, using `/` to separate nested names. Clearing the field returns a material to the top level. Editing requires the existing catalogue and part-edit permissions and an online connection. Browsing groups in the material-list add-parts picker works offline after catalogue synchronization. The catalogue management page keeps its existing online-only behavior.

The nullable-in-old-caches, optional client `groupPath` field is a bounded array of up to five names. Server storage is non-null JSONB with an empty-array default. Existing caches lacking the field remain valid and show a flat list until the next pull. Replicache's full catalogue snapshot includes group paths and ordinary catalogue-change notifications trigger refreshes. Group counts sum the filtered descendant materials, so the currently selected catalogue is respected. Empty materials are hidden by the existing picker rules. Breadcrumbs navigate out of any nested group.

Apply the additive `drizzle/0035_material_groups.sql` before deploying the new code. The helper `node --import dotenv/config --import tsx scripts/setup-material-groups.ts` previews initial PVC grouping for the organization belonging to `DEV_AUTH_EMAIL`; add `--apply` to back up existing settings, apply the migration, and group known PVC families. Existing nonempty paths are preserved. This follows the repository's standalone SQL migration convention; it does not run historical migrations.

Initial PVC setup includes XFR, PVC DWV, PVC Sch 40/80 and PVC BDS. Gasketed DR25 and DR35 are under PVC / Gasketed SDR. Empty legacy entries (Gasketed SDR, Gasketed Sewer Pipe and Ring-Tite) receive their PVC folder but remain hidden until they contain parts.

Changes to group assignments are validated and applied atomically within one organization. Duplicate material IDs and missing/foreign records reject the entire request. The server stores only grouping metadata; it does not merge or reassign parts.

Tests cover hierarchy/counts, old offline data, nested selection, breadcrumb returns, editor validation and recovery, and server permissions/scoping. Real-browser checks cover synced hierarchy, subtype-to-size selection, and offline navigation.
