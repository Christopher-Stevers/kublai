"""Independent PDF semantics/stress fixtures, not evidence of room accuracy."""
import gzip
import json
from pathlib import Path
import tempfile
import unittest
import zlib

from evidence import records
from run import child_extract, compile_java, sha


def stream(content, extra=b''):
    data = zlib.compress(content)
    return b'<< /Length ' + str(len(data)).encode() + b' /Filter /FlateDecode ' + extra + b' >>\nstream\n' + data + b'\nendstream'


def pdf_bytes(content, page_extra=b'', resources=b'<< >>', extras=()):
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>',
               b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
               b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 180] /Contents 4 0 R /Resources ' + resources + b' ' + page_extra + b' >>',
               stream(content), *extras]
    result, offsets = b'%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', [0]
    for i, obj in enumerate(objects, 1):
        offsets.append(len(result))
        result += str(i).encode() + b' 0 obj\n' + obj + b'\nendobj\n'
    xref = len(result)
    result += b'xref\n0 ' + str(len(offsets)).encode() + b'\n0000000000 65535 f \n'
    result += b''.join(f'{n:010d} 00000 n \n'.encode() for n in offsets[1:])
    return result + f'trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()


class StreamTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)
        cls.classes = cls.root / 'classes'
        compile_java(cls.classes)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def extract(self, content, **kw):
        directory = self.root / self._testMethodName
        directory.mkdir(exist_ok=True)
        index = len(list(directory.iterdir()))
        source = directory / f'{index}.pdf'
        source.write_bytes(pdf_bytes(content, **kw))
        output = directory / f'{index}.paint'
        result = child_extract(source, 0, output, self.classes, directory / f'{index}.log')
        self.assertTrue(result['successful'], (result, (directory / f'{index}.log').read_text()))
        return list(records(output)), json.loads((output / 'summary.json').read_text()), result, output

    def test_independent_door_preserves_curve_and_commands(self):
        rows, summary, _, _ = self.extract(b'0.2 w 10 100 m 60 100 l S 100 100 m 180 100 l S '
            b'10 104 m 60 104 l S 100 104 m 180 104 l S 60 100 m 60 104 l S '
            b'100 100 m 100 104 l S 60 104 m 60 144 l S '
            b'60 144 m 82.09139 144 100 126.09139 100 104 c S')
        paths = [r for r in rows if r[0] == 'p']
        self.assertEqual(summary['paths'], 8)
        self.assertEqual(summary['commands'], 16)
        self.assertEqual(paths[-1][6][:4], [0, 60, 36, 3])
        self.assertEqual(paths[-1][6][-2:], [100, 76])
        self.assertEqual(len(paths[-1][11]), 2)
        self.assertEqual([r for r in rows if r[0] == 's'][0][2][11], 'Normal')

    def test_crop_rotate_userunit_independent_goldens(self):
        expected = {0: [0, 10, 120, 1, 30, 80], 90: [0, 20, 10, 1, 60, 30],
                    180: [0, 150, 20, 1, 130, 60], 270: [0, 120, 150, 1, 80, 130]}
        for angle, golden in expected.items():
            rows, summary, _, _ = self.extract(b'15 30 m 25 50 l S',
                page_extra=f'/CropBox [10 20 90 90] /UserUnit 2 /Rotate {angle}'.encode())
            self.assertEqual([r for r in rows if r[0] == 'p'][0][6], golden)
            self.assertEqual([summary['width'], summary['height']], [160, 140] if angle % 180 == 0 else [140, 160])

    def test_forms_keep_outer_path_separate(self):
        form = stream(b'0 0 m 5 0 l S', b'/Type /XObject /Subtype /Form /BBox [-20 -20 100 100] /Matrix [2 0 0 2 40 50] /Resources << >>')
        rows, _, _, _ = self.extract(b'20 20 m /A Do 80 20 l S',
            resources=b'<< /XObject << /A 5 0 R >> >>', extras=[form])
        paths = [r for r in rows if r[0] == 'p']
        self.assertEqual([p[6] for p in paths], [[0, 40, 130, 1, 50, 130], [0, 20, 160, 1, 80, 160]])

    def test_type3_paint_is_tagged_not_a_wall(self):
        font = b'<< /Type /Font /Subtype /Type3 /Name /F1 /FontBBox [0 0 500 800] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << /A 6 0 R >> /Encoding << /Type /Encoding /Differences [65 /A] >> /FirstChar 65 /LastChar 65 /Widths [500] /Resources << >> >>'
        glyph = stream(b'500 0 0 0 500 800 d1 0 0 500 800 re f')
        rows, summary, _, _ = self.extract(b'20 20 m BT /F1 10 Tf 40 50 Td (A) Tj ET 80 20 l S',
            resources=b'<< /Font << /F1 5 0 R >> >>', extras=[font, glyph])
        paths = [r for r in rows if r[0] == 'p']
        self.assertEqual(summary['glyphs'], 1)
        self.assertTrue(paths[0][10])
        self.assertFalse(paths[1][10])
        for actual, expected in zip(paths[0][7], [40, 122, 45, 130]):
            self.assertAlmostEqual(actual, expected, places=4)
        self.assertEqual(paths[1][6], [0, 20, 160, 1, 80, 160])

    def test_nonembedded_glyph_stays_unknown(self):
        rows, summary, _, _ = self.extract(b'BT /F1 12 Tf 40 50 Td (A) Tj ET',
            resources=b'<< /Font << /F1 5 0 R >> >>',
            extras=[b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'])
        self.assertEqual(summary['unknownGlyphs'], 1)
        glyph = next(r for r in rows if r[0] == 'glyph')
        self.assertFalse(glyph[4])
        self.assertIsNone(glyph[5])

    def test_clip_save_restore_and_paint_order(self):
        rows, _, _, _ = self.extract(b'0.1 w 20 80 m 180 80 l S q 40 40 80 80 re W n '
                                      b'20 80 m 180 80 l S 1 g 60 60 20 20 re f Q 20 90 m 180 90 l S')
        paths = [r for r in rows if r[0] == 'p']
        states = {r[1]: r[2] for r in rows if r[0] == 's'}
        self.assertTrue(paths[0][8])
        self.assertFalse(paths[2][8])
        self.assertEqual(paths[3][4], 2)
        self.assertEqual(states[paths[3][3]][6][2], 0xffffff)
        self.assertEqual(states[paths[0][3]][14], states[paths[-1][3]][14])
        self.assertNotEqual(states[paths[2][3]][14], states[paths[-1][3]][14])

    def test_raw_chunk_tampering_rejected(self):
        _, summary, _, output = self.extract(b'20 20 m 80 20 l S')
        chunk = output / summary['chunks'][0][0]
        chunk.write_bytes(chunk.read_bytes() + b'x')
        with self.assertRaisesRegex(ValueError, 'compressed bytes'):
            list(records(output))

    def test_declared_count_tampering_rejected(self):
        _, summary, _, output = self.extract(b'20 20 m 80 20 l S')
        summary['events'] += 1
        (output / 'summary.json').write_text(json.dumps(summary))
        with self.assertRaisesRegex(ValueError, 'Whole-page'):
            list(records(output))

    def test_over_200k_individual_paths_under_original_budget(self):
        # Every line has its own stroke. This specifically exceeds the prior failed
        # parser's path count, with independently known commands and events.
        count = 200_101
        rows, summary, result, _ = self.extract(b'0.1 w\n' + b'20 20 m 80 20 l S\n' * count)
        self.assertEqual(summary['paths'], count)
        self.assertEqual(summary['events'], count)
        self.assertEqual(summary['commands'], count * 2)
        self.assertGreater(summary['uncompressedBytes'], 10_000_000)
        self.assertEqual(sum(r[0] == 'p' for r in rows), count)
        self.assertLess(result['seconds'], 60)
        self.assertLess(result['peak_rss_bytes'], 2 * 1024**3)
        print('STREAM_STRESS', json.dumps({'paths': count, **result}))


if __name__ == '__main__':
    unittest.main()
