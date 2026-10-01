import copy
import hashlib
from contextlib import contextmanager, ExitStack
from fractions import Fraction
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image

import build
import contract
from render import (DENSITIES, HEIGHT, WIDTH, axis_weights, coarse_masks, coverage,
                    density_schedule, page, structure_crop, transform)


def metadata():
    rows = []
    for i in range(100):
        rows.append({'id': 'floor-' + str(i), 'split': 'train' if i < 80 else 'validation',
                     'source': 'swiss-dwellings-real-geometry', 'site': 'site-' + str(i),
                     'group': 'group-' + str(i), 'component_aliases': ['alias-' + str(i)],
                     'source_row_snapshot_sha256': 'r' + str(i), 'image_sha256': f'{i:064x}',
                     'render_stats': {'all_space_scoring_eligible': False,
                                      'physical_room_ground_truth_certified': False, 'real_door_coordinates': True,
                                      'human_completeness_evidence':False, 'approved_for_production':False}})
    return {'dataset_contract': 'swiss-true-openings-ink-v4', 'version': 'structural-room-challenger-v1',
            'experiment': 'whole-sheet-context-v2', 'heads': contract.HEADS, 'overview': 512,
            'all_space_scoring_eligible': False, 'physical_room_ground_truth_certified': False,
            'human_completeness_evidence': False, 'records': rows, 'excluded_msd_sites': []}


def native_fixture():
    target = np.zeros((3, HEIGHT, WIDTH), np.uint8)
    known = np.ones_like(target)
    target[0, 144:1316, 164:1576] = 1
    target[1, 140:144, 160:1580] = 1; target[1, 1316:1320, 160:1580] = 1
    target[1, 140:1320, 160:164] = 1; target[1, 140:1320, 1576:1580] = 1
    target[2, 500:536, 160:164] = 1
    known[:, 900:920, 1000:1050] = 0
    image = np.full((HEIGHT, WIDTH, 3), 255, np.uint8)
    image[target[1] > 0] = 50; image[target[2] > 0] = 255
    image[:, 1792:1800] = [250, 0, 0]  # Source title block must not be carried.
    return image, target, known


@contextmanager
def completed_fixture(directory):
    """Fabricated metadata/byte ledgers only; fake asset bytes never decoded."""
    output = Path(directory) / 'out'; (output / 'assets').mkdir(parents=True)
    original_rows = metadata()['records']
    for i, row in enumerate(original_rows):
        row.update(building='b'+str(i), floor='f'+str(i), plan='p'+str(i))
        for key in ('targets', 'overview', 'references'):
            row[key+'_sha256'] = f'{1000+i:064x}'
    schedule = density_schedule(original_rows)
    frozen = {'runtime': contract.runtime(), 'source_hashes': {}, 'input_bindings': {},
              'baseline_bindings': {}, 'density_schedule': schedule}
    binding_path = output / 'binding.json'; binding_path.write_text('fabricated-binding')
    binding_sha = contract.digest(binding_path)
    emitted, result = {}, []
    for original in original_rows:
        row = copy.deepcopy(original); row['render_stats']['density'] = schedule[row['id']]
        names = {'image': row['id']+'.png', 'targets': row['id']+'.npz',
                 'overview': row['id']+'-overview.npz', 'references': row['id']+'.references.json'}
        for key, name in names.items():
            p = output/'assets'/name; p.write_bytes((key+':'+row['id']).encode())
            row[key], row[key+'_sha256'] = 'assets/'+name, contract.digest(p)
            emitted[str(p.resolve())] = row[key+'_sha256']
        original['references_sha256'] = row['references_sha256']
        base_sha = hashlib.sha256(json.dumps(original,sort_keys=True).encode()).hexdigest()
        row['baseline_record_sha256'] = base_sha
        receipt = output/'assets'/(row['id']+'.receipt.json')
        contract.write(receipt, {'id':row['id'],'split':row['split'],'group':row['group'],
              'baseline_record_sha256':base_sha,'baseline_asset_hashes':{k:original[k+'_sha256'] for k in names},
              'output_hashes':{k:row[k+'_sha256'] for k in names},'density':schedule[row['id']],
              'physical_room_ground_truth_certified':False,'all_space_scoring_eligible':False})
        emitted[str(receipt.resolve())] = contract.digest(receipt); result.append(row)
    manifest = {'version':'structural-room-challenger-v1','experiment':'whole-sheet-context-v2',
                'heads':contract.HEADS,'overview':512,'dataset_contract':contract.CONTRACT,
                'baseline_manifest_sha256':contract.DATA_SHA,'build_binding_sha256':binding_sha,
                'config':contract.CONFIG,'counts':contract.COUNTS,'runtime':frozen['runtime'],
                'source_hashes':{},'records':result,'all_space_scoring_eligible':False,
                'physical_room_ground_truth_certified':False,'human_completeness_evidence':False,
                'room_truth_member':'absent','training_runs':0,'inference_runs':0}
    contract.write(output/'manifest.json',manifest)
    emitted[str((output/'manifest.json').resolve())] = contract.digest(output/'manifest.json')
    audit = output/'AUDIT_CLEAR.json'
    contract.write(audit,{'outcome':'CLEAR','scope':'one-fixed-domain-data-build','binding_sha256':binding_sha,
                          'source_hashes':{},'reviewer':'fabricated test only'})
    audit_sha = contract.digest(audit); claim_path = Path(directory)/'claim.json'
    contract.write(claim_path,{'contract':contract.CONTRACT,'output':str(output.resolve()),'binding_sha256':binding_sha,
                               'data_sha256':contract.DATA_SHA,'config':contract.CONFIG,'audit_clear_sha256':audit_sha})
    claim_sha = contract.digest(claim_path)
    done = {'contract':contract.CONTRACT,'output':str(output.resolve()),'binding_sha256':binding_sha,
            'runtime':frozen['runtime'],'source_hashes':{},'training_runs':0,'inference_runs':0,
            'all_space_scoring_eligible':False,'physical_room_ground_truth_certified':False,
            'human_completeness_evidence':False,'approved_for_production':False,
            'manifest_sha256':contract.digest(output/'manifest.json'),
            'audit_clear_sha256':audit_sha,'claim_sha256':claim_sha,'emitted_hashes':emitted}
    contract.write(output/'completed.json',done)
    global_path = Path(directory)/'global-completed.json'
    contract.write(global_path,{'contract':contract.CONTRACT,'output':str(output.resolve()),'binding_sha256':binding_sha,
                  'completed_sha256':contract.digest(output/'completed.json'),'manifest_sha256':done['manifest_sha256'],
                  'claim_sha256':claim_sha,'audit_clear_sha256':audit_sha,'runtime':frozen['runtime'],
                  'source_hashes':{},'emitted_hashes':emitted,'all_space_scoring_eligible':False,
                  'physical_room_ground_truth_certified':False,'human_completeness_evidence':False,
                  'approved_for_production':False})
    with ExitStack() as stack:
        stack.enter_context(patch.object(contract,'OUTPUT',output))
        stack.enter_context(patch.object(contract,'CLAIM',claim_path))
        stack.enter_context(patch.object(contract,'RECEIPT',global_path))
        stack.enter_context(patch.object(contract,'sources',return_value={}))
        stack.enter_context(patch.object(contract,'read_binding',return_value=(frozen,{},original_rows,binding_sha)))
        yield output, done, global_path


class TransformTests(unittest.TestCase):
    def test_rational_support_has_no_boundary_rounding_neighbors(self):
        w = axis_weights(10, 7, 10).toarray()
        self.assertEqual(w.shape, (7, 10)); np.testing.assert_allclose(w.sum(axis=1), 1)
        self.assertEqual(w[0, 2], 0); self.assertEqual(w[-1, -1], .7)
        np.testing.assert_allclose(axis_weights(4, 1, 1).toarray(), np.eye(4))

    def test_partial_destination_cell_pads_white_and_not_unknown(self):
        image = np.zeros((3, 3, 3), np.uint8)
        target = np.zeros((3, 3, 3), np.uint8); known = np.ones_like(target)
        rgb, out, mask = transform(image, target, known, '0.4')
        self.assertEqual(rgb.shape, (2, 2, 3)); self.assertGreater(int(rgb[-1, -1, 0]), 0)
        self.assertFalse(out.any()); self.assertTrue(mask.all())

    def test_every_thin_door_has_support_at_all_declared_scales(self):
        image = np.full((20, 20, 3), 255, np.uint8)
        for density in DENSITIES:
            for y, x in ((0, 0), (4, 7), (19, 19)):
                t = np.zeros((3, 20, 20), np.uint8); k = np.ones_like(t)
                t[1:, y, x] = 1
                _, out, mask = transform(image, t, k, density)
                self.assertGreater(int(out[2].sum()), 0)
                self.assertFalse(np.any(out[2] > out[1])); self.assertTrue(mask[2].all())

    def test_any_unknown_propagates_and_unknown_door_is_retained(self):
        image = np.full((10, 10, 3), 255, np.uint8)
        t = np.zeros((3, 10, 10), np.uint8); k = np.ones_like(t)
        t[1:, 2, 2] = 1; k[:, 2, 2] = 0
        _, out, mask = transform(image, t, k, '0.4')
        self.assertTrue(out[2].any()); self.assertTrue(np.all(mask[2][out[2] > 0] == 0))
        q = Fraction('0.4'); weights = axis_weights(10, q.numerator, q.denominator)
        expected_unknown = coverage(k[2] == 0, weights, weights) > 0
        np.testing.assert_array_equal(mask[2] == 0, expected_unknown)

    def test_mixed_interior_never_becomes_a_known_negative(self):
        image = np.full((10, 10, 3), 255, np.uint8)
        t = np.zeros((3, 10, 10), np.uint8); k = np.ones_like(t)
        t[0, 4, :] = 1; t[1, 3, :] = 1
        _, out, mask = transform(image, t, k, '0.4')
        wy = wx = axis_weights(10, 2, 5)
        mixed = (coverage(t[0], wy, wx) > 0) & (coverage(t[0], wy, wx) < 1)
        self.assertTrue(mixed.any()); self.assertTrue(np.all(mask[0][mixed] == 0))
        self.assertFalse(np.any((out[0] > 0) & (out[1] > 0)))

    def test_coarse_retains_thin_opening_and_any_unknown(self):
        t = np.zeros((3, 12, 16), np.uint8); k = np.ones_like(t)
        t[1:, 5, 6] = 1; k[:, 5, 6] = 0
        out, mask = coarse_masks(t, k, size=4)
        self.assertTrue(out[2].any()); self.assertTrue(np.all(mask[2][out[2] > 0] == 0))
        self.assertFalse(np.any(out[2] > out[1]))

    def test_hole_is_not_filled_by_area_transform(self):
        t = np.zeros((3, 30, 30), np.uint8); k = np.ones_like(t)
        t[0, 2:28, 2:28] = 1; t[0, 10:20, 10:20] = 0
        image = np.full((30, 30, 3), 255, np.uint8)
        _, out, _ = transform(image, t, k, '0.4')
        self.assertEqual(int(out[0, 6, 6]), 0)

    def test_crop_retains_support_and_removes_old_title(self):
        image, target, known = native_fixture()
        crop, t, k, bounds = structure_crop(image, target, known)
        self.assertEqual(int(t[2].sum()), int(target[2].sum()))
        self.assertEqual(int((k == 0).sum()), int((known == 0).sum()))
        self.assertFalse(np.any(crop[:, :, 0] != crop[:, :, 1])); self.assertLess(bounds[2], 1792)
        target[1, 140, 1790] = 1
        with self.assertRaises(ValueError): structure_crop(image, target, known)

    def test_full_fabricated_page_is_deterministic_isotropic_and_input_only(self):
        image, target, known = native_fixture()
        before = target.copy(), known.copy(), image.copy()
        a = page(image, target, known, '0.7', 20260930)
        b = page(image, target, known, '0.7', 20260930)
        np.testing.assert_array_equal(np.asarray(a[0]), np.asarray(b[0]))
        for i in range(1, 5): np.testing.assert_array_equal(a[i], b[i])
        self.assertEqual(a[5], b[5]); self.assertGreater(a[5]['chromatic_pixels'], 0)
        self.assertFalse(a[5]['all_space_scoring_eligible'])
        affine = a[5]['uniform_affine_source_pixel_to_destination']
        self.assertEqual(affine[0][0], affine[1][1]); self.assertEqual(affine[0][0], .7)
        self.assertLessEqual(len(a[5]['fixtures']), 160); self.assertLessEqual(len(a[5]['parking_landscape']), 32)
        for fixture in a[5]['fixtures']:
            x0, y0, x1, y1 = fixture['box']
            self.assertTrue(((a[1][0, y0:y1+1, x0:x1+1] > 0) & (a[2][0, y0:y1+1, x0:x1+1] > 0)).all())
        np.testing.assert_array_equal(target, before[0]); np.testing.assert_array_equal(known, before[1]); np.testing.assert_array_equal(image, before[2])

    def test_inside_box_nuisance_uses_supplied_negative_pockets_with_margin(self):
        image, target, known = native_fixture()
        target[0, 600:930, 600:1050] = 0
        result = page(image, target, known, '0.7', 20260930)
        motifs = result[5]['known_negative_pocket_motifs']
        self.assertGreater(len(motifs),0); self.assertLessEqual(len(motifs),8)
        for x0,y0,x1,y1 in motifs:
            self.assertFalse(result[1][:,y0-12:y1+13,x0-12:x1+13].any())
            self.assertTrue(result[2][:,y0-12:y1+13,x0-12:x1+13].all())


class ContractTests(unittest.TestCase):
    def test_freeze_captures_source_identity_before_metadata(self):
        with patch.object(contract,'sources',side_effect=[{'build.py':'a'*64},{'build.py':'b'*64}]), \
             patch.object(contract,'source_metadata',return_value=({}, [])), patch.object(contract,'asset') as assets:
            with self.assertRaises(ValueError):contract.freeze()
            assets.assert_not_called()

    def test_complete_original_metadata_chain_is_accepted_without_decoding(self):
        with tempfile.TemporaryDirectory() as d, completed_fixture(d) as (output,done,_):
            manifest, receipt = contract.completed_build(output)
            self.assertEqual(len(manifest['records']),100); self.assertEqual(receipt,done)

    def test_global_original_receipt_and_exact_emission_set_are_required(self):
        with tempfile.TemporaryDirectory() as d, completed_fixture(d) as (output,done,global_path):
            global_path.write_text('{}')
            with self.assertRaises(ValueError):contract.completed_build(output)
        with tempfile.TemporaryDirectory() as d, completed_fixture(d) as (output,done,global_path):
            done['emitted_hashes'] = {}
            (output/'completed.json').write_text(json.dumps(done))
            global_value = json.loads(global_path.read_text())
            global_value.update(completed_sha256=contract.digest(output/'completed.json'), emitted_hashes={})
            global_path.write_text(json.dumps(global_value))
            with self.assertRaises(ValueError):contract.completed_build(output)

    def test_completion_rejects_output_mutation_after_initial_checks(self):
        with tempfile.TemporaryDirectory() as d, completed_fixture(d) as (output,done,_):
            called = [False]
            def late_sources():
                if not called[0]:
                    next((output/'assets').glob('*.png')).write_bytes(b'late rewrite')
                    called[0] = True
                return {}
            with patch.object(contract,'sources',side_effect=late_sources):
                with self.assertRaises(ValueError):contract.completed_build(output)

    def test_completion_rechecks_archived_source_after_decode(self):
        with tempfile.TemporaryDirectory() as d, completed_fixture(d) as (output,done,_):
            with patch.object(contract,'archived_sources',side_effect=ValueError('late archive drift')):
                with self.assertRaises(ValueError):contract.completed_build(output)

    def test_completion_rejects_late_global_control_and_current_source_mutations(self):
        for change in ('global', 'source'):
            with tempfile.TemporaryDirectory() as d, completed_fixture(d) as (output,done,global_path):
                def late_sources():
                    if change=='global':global_path.write_text('{}'); return {}
                    return {'unexpected.py':'0'*64}
                with patch.object(contract,'sources',side_effect=late_sources):
                    with self.assertRaises(ValueError):contract.completed_build(output)

    def test_balanced_schedule_invariant_to_record_order_and_split(self):
        rows = metadata()['records']; a = density_schedule(rows); b = density_schedule(list(reversed(rows)))
        self.assertEqual(a, b)
        self.assertEqual([sum(a[r['id']] == s for r in rows if r['split'] == 'train') for s in DENSITIES], [27, 27, 26])
        self.assertEqual([sum(a[r['id']] == s for r in rows if r['split'] == 'validation') for s in DENSITIES], [7, 7, 6])

    def test_metadata_preflight_rejects_alias_site_and_component_crossings(self):
        data = metadata(); self.assertEqual(len(contract.validate_metadata(data)), 100)
        for field in ('site', 'group', 'component_aliases', 'source_row_snapshot_sha256', 'image_sha256'):
            mutated = copy.deepcopy(data); mutated['records'][80][field] = mutated['records'][0][field]
            with self.assertRaises(ValueError): contract.validate_metadata(mutated)
        data['records'][0]['render_stats']['physical_room_ground_truth_certified'] = True
        with self.assertRaises(ValueError): contract.validate_metadata(data)

    def test_copy_output_rejected_before_any_source_access(self):
        with patch.object(contract, 'source_metadata') as access:
            with self.assertRaises(ValueError): contract.read_binding(Path('/fabricated-copied-output'))
            access.assert_not_called()

    def test_no_audit_clear_means_no_decode_or_claim(self):
        with tempfile.TemporaryDirectory() as d:
            with patch.object(build, 'read_binding', return_value=({}, {}, [], '0'*64)), \
                 patch.object(contract, 'OUTPUT', Path(d)), patch.object(build, 'decode_baseline') as decode, \
                 patch.object(build, 'claim') as claimed:
                with self.assertRaises(FileNotFoundError): build.build()
                decode.assert_not_called(); claimed.assert_not_called()

    def test_decode_does_not_open_provisional_truth_and_detects_late_asset_mutation(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); (root / 'baseline').mkdir()
            img = root / 'baseline/x.png'; masks = root / 'baseline/x.npz'
            Image.fromarray(np.full((8, 8, 3), 255, np.uint8)).save(img)
            t = np.zeros((3, 8, 8), np.uint8); k = np.ones_like(t)
            # Accessing this object-array member with allow_pickle=False would
            # fail. It remains deliberately unread by the decoder.
            np.savez_compressed(masks, target=t, known=k, truth=np.array([object()], dtype=object))
            row = {'image': 'x.png', 'targets': 'x.npz', 'image_sha256': contract.digest(img), 'targets_sha256': contract.digest(masks)}
            with patch.object(build, 'OUTPUT', root):
                self.assertEqual(build.decode_baseline(row)[1].shape, (3, 8, 8))
                original_load = np.load
                def late(*args, **kwargs):
                    values = original_load(*args, **kwargs); img.write_bytes(b'changed after image decode'); return values
                with patch.object(build.np, 'load', side_effect=late):
                    with self.assertRaises(ValueError): build.decode_baseline(row)


if __name__ == '__main__':
    unittest.main()
