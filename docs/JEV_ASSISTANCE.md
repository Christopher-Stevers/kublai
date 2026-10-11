# AI assistance workspace retired

On 2026-10-10, Tim requested removal of all six AI assistance tools: material finding, supplier matching, catalogue organization, material-list checks, drawing classification and room-outline review.

Their interface, entry links, API router, TypeSafe client, cache, PDF text worker and dedicated tests have been removed. Old `/dashboard/assist` bookmarks redirect to Jobs. No database migration is required; these tools did not persist changes. Existing room detection and normal catalogue, supplier, material-list and drawing tools remain independent.

The application no longer reads TypeSafe environment settings for this workspace. The project TypeSafe skill remains available for any future explicitly requested integration.
