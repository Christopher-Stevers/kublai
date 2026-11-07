"""An image/vector pair must share the exact PDF AND its source page.

ForemanHQ's database pageNumber may be an import slot. Production already uses
the source page encoded by floor-N.webp. PDF.js/Poppler are one-based; PDFBox's
PDDocument.getPage is zero-based. Equal aspect ratios prove neither identity.
"""
import hashlib
import json
from pathlib import Path


def sha(path):
    with Path(path).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def checked(path, expected):
    if sha(path) != expected:
        raise ValueError('Original receipt bytes changed')
    return json.loads(Path(path).read_text())


def same_page(image, vector, summary):
    number, index = image['pdfPageNumber'], image['pdfPageIndex']
    if type(number) is not int or type(index) is not int or number < 1 or index != number-1:
        raise ValueError('Inconsistent one-based/zero-based image page')
    if image['sourcePdfSha256'] != vector['source_sha256']:
        raise ValueError('Different PDF sources')
    if vector['page_index'] != index or summary['pageIndex'] != index:
        raise ValueError('Different source pages; database slot/aspect ratio cannot substitute')
    if image.get('derivedFromFreshRender') is not True or image['pngSha256'] != image['cacheSha256']:
        raise ValueError('Image was not verified against the source render')
    w, h = image['width'], image['height']
    if min(w, h, summary['width'], summary['height']) <= 0 or abs(w/h-summary['width']/summary['height']) > 2/min(w, h):
        raise ValueError('Incompatible full-page viewport')
    return {'pdf_sha256': image['sourcePdfSha256'], 'pdf_page_number': number,
            'pdf_page_index': index, 'png_sha256': image['pngSha256'],
            'full_page_isotropic_frame': True}


def validate(image_receipt, image_receipt_sha, source_png, vector_root):
    vector_root = Path(vector_root)
    image = checked(image_receipt, image_receipt_sha)
    completed = json.loads((vector_root/'completed.json').read_text())
    if completed['successful'] is not True:
        raise ValueError('No successful extraction')
    plan = checked(vector_root/'plan.json', completed['plan_sha256'])
    summary = checked(vector_root/'paint/summary.json', completed['summary_sha256'])
    if sha(source_png) != image['pngSha256'] or sha(plan['source']) != plan['source_sha256']:
        raise ValueError('Drawing bytes changed')
    for name, digest in plan['sources'].items():
        if sha(vector_root/'sources'/name) != digest:
            raise ValueError('Extractor source archive changed')
    binding = same_page(image, plan, summary)
    binding['image_receipt_sha256'] = image_receipt_sha
    binding['vector_completion_sha256'] = sha(vector_root/'completed.json')
    binding['vector_summary_sha256'] = completed['summary_sha256']
    return binding
