# Estimating workspace

Visual thesis: a calm, dense cost spreadsheet with blue actions, restrained borders, and a drawing evidence inspector beside the working rows.

Content plan: estimate register and job filters; editable takeoff and rates; evidence and review; pricing settings and proposal scope; persistent selling-price summary and export actions.

Interaction thesis: persistent summary during long edits, fast table focus/hover affordances, and concise dialog transitions; respect reduced motion through the shared UI primitives.

Editing uses explicit revision-bound saves. Imports are serialized and retain successful chunks on cancellation. A conflicting server revision never replaces an unsaved local document.

Phone layout: fit-width cost items with labeled quantity/rate/total fields and per-item disclosure; full-width filters, drawing selection, and pricebook editing. Desktop retains the worksheet. A compact selling total sits above the phone workspace and opens totals, status and export actions. Section navigation uses a native selector. Details expand quickly through existing controls with no decorative motion; dialogs remain bounded by the visible viewport.
