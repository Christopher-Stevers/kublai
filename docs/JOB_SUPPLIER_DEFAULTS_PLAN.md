# Job supplier defaults

Each job has ordered supplier-default cards. A card filters catalog, material, size, category, or any combination. Every selected filter must match. The first matching card wins. Cards can be dragged or moved up/down. The fallback supplier is a separate pinned last card.

Each card has one combined supplier-version selector, using names such as Next and Next (Alma). There is no separate pricing-list field. Internally a version identifies the supplier and its optional uploaded spreadsheet book. A version without uploaded prices does not acquire prices from a different version.

Store the rules with the job through Replicache, with organization and job-edit checks on the server. Download them for offline use. Apply them to newly added material parts, allow manual overrides, and retain the selected version on each new line. Changing defaults does not rewrite existing or sent lines. Tools continue to go to the tool room. Sending remains online and keeps existing approval checks.

Validate overlapping filters and priority, fallback, combined filters, unit and reducing-size matching, cross-organization rejection, offline selection, manual overrides, and standard versus named-book pricing. Release only after tests, type checking, and the production build pass.
