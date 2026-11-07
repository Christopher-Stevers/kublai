import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from stress import (generate, generate_case, rotation_parameters, rotate,
                    select_development, sha, transform_annotation, transform_point)


def fixture(root):
    (root / 'sources').mkdir()
    (root / 'plans').mkdir()
    (root / 'annotations').mkdir()
    image = Image.new('RGB', (128, 128), 'white')
    draw = ImageDraw.Draw(image)
    draw.rectangle((15, 15, 110, 110), outline='black', width=4)
    draw.line((64, 16, 64, 109), fill='black', width=4)
    image.save(root / 'plans' / 'case.png')
    annotation = {'id': 'case', 'rooms': [
        {'id': 'left', 'name': 'BEDROOM', 'seed': [.3, .5], 'polygon': {
            'type': 'Polygon', 'coordinates': [[[.15, .15], [.48, .15], [.48, .85], [.15, .85], [.15, .15]]]}},
        {'id': 'right', 'name': 'KITCHEN', 'seed': [.7, .5], 'polygon': {
            'type': 'MultiPolygon', 'coordinates': [[[[.52, .15], [.85, .15], [.85, .85], [.52, .85], [.52, .15]],
                [[.6, .6], [.65, .6], [.65, .65], [.6, .65], [.6, .6]]]]}}]}
    (root / 'annotations' / 'case.json').write_text(json.dumps(annotation))
    row = {'id': 'case', 'source_id': 1, 'split': 'development', 'path': 'plans/case.png',
           'annotation_path': 'annotations/case.json', 'room_count': 2, 'sha256': sha(root / 'plans/case.png')}
    # The nonexistent holdout paths ensure accidental reads fail the test.
    heldout = dict(row, id='holdout', split='holdout', path='missing-heldout.png', annotation_path='missing-heldout.json')
    (root / 'sources' / 'resplan-manifest.json').write_text(json.dumps([heldout, row]))
    return row, annotation


class StressTests(unittest.TestCase):
    def test_seed_and_polygon_transform_share_coordinates_including_holes(self):
        with tempfile.TemporaryDirectory() as temp:
            _, annotation = fixture(Path(temp))
            original = copy.deepcopy(annotation)
            annotation['rooms'][0]['seed'] = annotation['rooms'][0]['polygon']['coordinates'][0][0][:]
            parameters = rotation_parameters(128, 128)
            transformed = transform_annotation(annotation, parameters)
            self.assertEqual(transformed['rooms'][0]['seed'], transformed['rooms'][0]['polygon']['coordinates'][0][0])
            hole = annotation['rooms'][1]['polygon']['coordinates'][0][1]
            self.assertEqual(transformed['rooms'][1]['polygon']['coordinates'][0][1], [transform_point(p, parameters) for p in hole])
            self.assertEqual(annotation['rooms'][1], original['rooms'][1])

    def test_rotation_padding_preserves_bounds(self):
        for width, height in [(2048, 2048), (1024, 2048), (2048, 256)]:
            parameters = rotation_parameters(width, height)
            for x in (0, .5, 1):
                for y in (0, .5, 1):
                    self.assertTrue(all(0 <= v <= 1 for v in transform_point([x, y], parameters)))

    def test_image_marker_matches_rotated_seed(self):
        image = Image.new('RGB', (128, 128), 'white')
        ImageDraw.Draw(image).ellipse((37, 72, 43, 78), fill='black')
        annotation = {'rooms': [{'seed': [40 / 127, 75 / 127], 'polygon': {'type': 'Polygon', 'coordinates': []}}]}
        output, transformed, _ = rotate(image, annotation)
        y, x = np.nonzero(np.asarray(output.convert('L')) < 100)
        seed = transformed['rooms'][0]['seed']
        self.assertLess(abs(float(x.mean()) - seed[0] * 127), .8)
        self.assertLess(abs(float(y.mean()) - seed[1] * 127), .8)

    def test_refuses_holdout_before_reading_paths(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with self.assertRaisesRegex(ValueError, 'holdout'):
                generate_case(root, root / 'stress', {'split': 'holdout'})
            with self.assertRaisesRegex(ValueError, 'holdout'):
                select_development([{'id': 'a', 'split': 'holdout'}], 1)

    def test_generation_is_identical_and_preserves_reference_for_image_corruptions(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            _, original = fixture(root)
            manifest = generate(root, 12)
            first = {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
                     for p in (root / 'stress').rglob('*') if p.is_file()}
            generate(root, 12)
            second = {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
                      for p in (root / 'stress').rglob('*') if p.is_file()}
            self.assertEqual(first, second)
            rows = json.loads(manifest.read_text())
            self.assertEqual(len(rows), 3)
            for row in rows:
                self.assertEqual(row['split'], 'development')
                self.assertEqual(sha(root / row['path']), row['sha256'])
                annotation = json.loads((root / row['annotation_path']).read_text())
                self.assertEqual(annotation['id'], row['id'])
                if row['stress_variant'] != 'rotation':
                    self.assertEqual(annotation['rooms'], original['rooms'])
            gap = next(r for r in rows if r['stress_variant'] == 'gaps')
            self.assertGreater(gap['corruption_parameters']['actual_gaps'], 0)

    def test_selection_stable_and_checksums_enforced(self):
        rows = [{'id': str(i), 'split': 'development'} for i in range(10)]
        self.assertEqual(select_development(rows, 4), select_development(rows[::-1], 4))
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            row, _ = fixture(root)
            row['sha256'] = 'wrong'
            with self.assertRaisesRegex(ValueError, 'checksum'):
                generate_case(root, root / 'stress', row)
            with self.assertRaisesRegex(ValueError, 'outside corpus'):
                generate(root, output_subdir='../outside')


if __name__ == '__main__':
    unittest.main()
