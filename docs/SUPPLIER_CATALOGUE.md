# Supplier mode in the catalogue

Use the View selector above the existing parts wizard, choose Supplier parts,
then choose a supplier. Catalogue, material, size and category choices are scoped
to that supplier's active catalogue parts. Search accepts catalogue names and
aliases as before, plus that supplier's SKU and description. All parts returns
to the ordinary catalogue.

Cards and the table show supplier descriptions, SKUs, order multiples and prices
(with financial permission). Opening a part edits supplier SKU, description,
minimum/order multiple, order unit, price, currency, notes and preferred status.
Multiple SKUs for the same catalogue part remain separate editable listings.
Prices are per selling/ordering unit (a whole pack for packaged parts), and these
are supplier catalogue prices; job price lists stay separate. Clearing a price
means unknown, not zero. Order multiples are distinct from pieces per pack.

The supplier listing is linked by partDefinitionId. This mode reuses the part's
photo and catalogue classification and does not overwrite its shared description,
image, aliases or job-specific pricing. Supplier identity is also captured in
saved catalogue destinations. Switching supplier remounts the wizard to prevent
filters from another supplier carrying across.

Supplier mode fetches server-scoped facets and results, even when the complete
Replicache catalogue is cached. Facets use a subquery so multiple listings do not
double-count catalogue parts. Supplier list/read/write queries are scoped to the
organization. Supplier or part edit permission allows edits; financial permission
is needed for prices/currency. Read-only users can inspect other fields.

Preferred changes and updates are transactional, including order-multiple total
refreshes; SKU conflicts preserve prior preferences. Locked sent order snapshots
remain unchanged. Sync pokes and catalogue events refresh connected clients.
No database migration is needed.

Validation includes warm-cache wizard behavior, supplier switching and edit
routing, read-only and monetary-field visibility, invalid/cleared fields,
multiple SKUs, supplier facet/search queries against isolated PostgreSQL,
cross-organization records and conflict rollback, and existing purchasing tests.
