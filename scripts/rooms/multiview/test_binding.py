import copy
import unittest
from page_binding import same_page


class BindingTests(unittest.TestCase):
    def setUp(self):
        self.image = {'pdfPageNumber': 18, 'pdfPageIndex': 17, 'sourcePdfSha256': 'a'*64,
                      'derivedFromFreshRender': True, 'pngSha256': 'b'*64, 'cacheSha256': 'b'*64,
                      'width': 5000, 'height': 3750}
        self.plan = {'source_sha256': 'a'*64, 'page_index': 17}
        self.summary = {'pageIndex': 17, 'width': 3456, 'height': 2592}

    def test_accepts_equivalent_page_conventions(self):
        self.assertEqual(same_page(self.image, self.plan, self.summary)['pdf_page_index'], 17)

    def test_same_size_adjacent_page_is_rejected(self):
        self.plan['page_index'] = self.summary['pageIndex'] = 18
        with self.assertRaisesRegex(ValueError, 'Different source pages'):
            same_page(self.image, self.plan, self.summary)

    def test_receipt_index_is_not_database_slot(self):
        self.image['pdfPageNumber'] = 19
        with self.assertRaisesRegex(ValueError, 'one-based'):
            same_page(self.image, self.plan, self.summary)

    def test_changed_pdf_rejected(self):
        self.plan['source_sha256'] = 'c'*64
        with self.assertRaisesRegex(ValueError, 'Different PDF'):
            same_page(self.image, self.plan, self.summary)

    def test_rendered_image_must_match_cache(self):
        self.image['cacheSha256'] = 'c'*64
        with self.assertRaisesRegex(ValueError, 'verified'):
            same_page(self.image, self.plan, self.summary)

    def test_wrong_viewport_rejected(self):
        self.summary['height'] = 1000
        with self.assertRaisesRegex(ValueError, 'viewport'):
            same_page(self.image, self.plan, self.summary)


if __name__ == '__main__':
    unittest.main()
