# Equipment-tag hyperlink search

Drawing a hyperlink reads the PDF text inside its region. One detected equipment
tag starts a search automatically; multiple detected tags require a choice.
A manually entered tag and Search links are available when no text can be read.

Search checks current logical drawing pages in the same drawing set and documents
visible to the current user in that job. Names, tags, descriptions and submittal
metadata are checked. PDF, DOCX, XLSX and PPTX contents are indexed too. Full-tag
boundaries avoid treating HEX-20 or HEX-2A as HEX-2; spacing and dash variants are
accepted. This is deterministic text matching, not semantic identification of
equipment or proof that a document is applicable.

Matches are added to the hyperlink draft, keeping existing destinations. Save the
hyperlink to persist them. Cancel/closing a draft does not save late results.
Drawing destinations include the source revision, zoom, exact text bounds and a
visible highlight in their snapshot link. The normal drawing viewer restores it.
The existing hyperlink limit of 50 destinations still applies, with an explicit
note when exceeded or when matches were already linked.

Indexing is isolated in 512 MB workers, at most two concurrent builders per web
process, with 60-second timeouts, private atomic immutable-source sidecars, and a
bounded in-memory cache. Maximum source size is 160 MB; PDF indexing stops after
2,000 pages and reports that limit. Office selected XML decompression is limited
to 32 MB. Index failure, unsupported content and PDFs without embedded text are
reported as search gaps, not as evidence of no matches. Automatic OCR of all
scanned pages, images and unsupported document formats is not implemented.
Existing manual links and drawing text-recognition tools remain available.

Source selection and each scan recheck drawing access, job/drawing-set boundaries
and current document visibility. Storage paths come from validated job image URLs
or private document hashes, never client-supplied file paths. Scanning never
changes documents, orders, quantities or source PDFs.
