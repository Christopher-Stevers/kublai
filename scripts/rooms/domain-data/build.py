"""Separately audited, once-only generated data build; no training/inference."""
import argparse
import copy
import hashlib
import json
import os
import shutil
import time

import numpy as np
from PIL import Image

from contract import (CLAIM, RECEIPT, CONFIG, CONTRACT, COUNTS, DATA_SHA, HEADS, OUTPUT, SEED,
                      archived_sources, asset, audit_clear, claim, digest, freeze, read_binding,
                      runtime, sources, verify, write)
from render import OVERVIEW, page


def decode_baseline(row):
    root = OUTPUT / 'baseline'
    img = asset(root, row['image'], row['image_sha256'])
    masks = asset(root, row['targets'], row['targets_sha256'])
    with Image.open(img) as im:
        image = np.asarray(im.convert('RGB')).copy()
    with np.load(masks, allow_pickle=False) as values:
        target, known = values['target'].copy(), values['known'].copy()
        # No access to the archive's provisional truth member.
    verify({str(img): row['image_sha256'], str(masks): row['targets_sha256']})
    if (target.shape != (3, *image.shape[:2]) or target.shape != known.shape
            or not np.isin(target, (0, 1)).all() or not np.isin(known, (0, 1)).all()
            or np.any(target[2] > target[1])):
        raise ValueError('Malformed baseline supervision or opening footprint subset')
    return image, target, known


def build():
    binding, baseline, originals, binding_sha = read_binding()
    audit_path, audit_sha = audit_clear(binding, binding_sha)
    claim_sha = claim(binding_sha, audit_sha)
    # Claim is global to this experiment, outside outputs. Copying/removing an
    # output directory cannot authorize another renderer execution.
    emitted, rows = {}, []
    assets = OUTPUT / 'assets'; assets.mkdir(mode=0o700, exist_ok=False)
    started = time.monotonic()
    for original in sorted(originals, key=lambda r: r['id']):
        image, target, known = decode_baseline(original)
        ident = original['id']; density = binding['density_schedule'][ident]
        seed = SEED + int(hashlib.sha256(ident.encode()).hexdigest()[:8], 16)
        image, target, known, coarse, coarse_known, stats = page(image, target, known, density, seed)
        paths = {'image': assets / (ident + '.png'), 'targets': assets / (ident + '.npz'),
                 'overview': assets / (ident + '-overview.npz'), 'references': assets / (ident + '.references.json')}
        image.save(paths['image']); paths['image'].chmod(0o600)
        emitted[str(paths['image'].resolve())] = digest(paths['image'])
        np.savez_compressed(paths['targets'], target=target, known=known); paths['targets'].chmod(0o600)
        emitted[str(paths['targets'].resolve())] = digest(paths['targets'])
        np.savez_compressed(paths['overview'], target=coarse, known=coarse_known); paths['overview'].chmod(0o600)
        emitted[str(paths['overview'].resolve())] = digest(paths['overview'])
        original_ref = asset(OUTPUT / 'baseline', original['references'], original['references_sha256'])
        shutil.copyfile(original_ref, paths['references']); paths['references'].chmod(0o600)
        emitted[str(paths['references'].resolve())] = digest(paths['references'])
        if emitted[str(paths['references'].resolve())] != original['references_sha256']:
            raise ValueError('Source reference bytes changed')
        row = copy.deepcopy(original)
        for key, path in paths.items():
            row[key], row[key + '_sha256'] = str(path.relative_to(OUTPUT)), emitted[str(path.resolve())]
        row['baseline_id'], row['domain_seed'] = ident, seed
        row['baseline_record_sha256'] = hashlib.sha256(json.dumps(original, sort_keys=True).encode()).hexdigest()
        row['baseline_asset_hashes'] = {key: original[key + '_sha256'] for key in paths}
        row['render_stats'] = {**row['render_stats'], **stats,
                               'pixels_per_source_meter': original['render_stats']['pixels_per_source_meter'] * float(density),
                               'target_positive_pixels': {head: int(target[i].sum()) for i, head in enumerate(HEADS)},
                               'provisional_components': None,
                               'truth_reference_kind': 'not-created; source functional references only',
                               'source_reference_memberships': 'baseline pixel memberships only; invalid on transformed raster'}
        row['limitations'] = ('Generated transform of genuine physical raster footprints. Source functional areas are not certified physical rooms. '
                              'Any-overlap raster support expands transformed footprint edges by at most a destination pixel cell. '
                              'Mixed interior and any source unknown pixels remain unsupervised. '
                              'Original references remain in source meters; affine metadata maps source pixels. '
                              'Source door swing ink beyond the crop halo may be clipped; real door footprints are retained. '
                              'No physical-room truth arrays or real-sheet completeness evidence.')
        rows.append(row)
        write(assets / (ident + '.receipt.json'), {'id': ident, 'split': row['split'], 'group': row['group'],
              'baseline_record_sha256': row['baseline_record_sha256'], 'baseline_asset_hashes': row['baseline_asset_hashes'],
              'output_hashes': {key: row[key + '_sha256'] for key in paths}, 'density': density,
              'physical_room_ground_truth_certified': False, 'all_space_scoring_eligible': False})
        receipt = assets / (ident + '.receipt.json'); emitted[str(receipt.resolve())] = digest(receipt)
        print(json.dumps({'rendered': len(rows), 'id': ident, 'density': density,
                          'chromatic_pixels': stats['chromatic_pixels'], 'new_fixtures': len(stats['fixtures'])}), flush=True)
    final, _, _, final_sha = read_binding()
    if final != binding or final_sha != binding_sha or digest(audit_path) != audit_sha or digest(CLAIM) != claim_sha:
        raise ValueError('Build claim/audit/binding changed during rendering')
    verify(emitted)
    manifest = {'version': baseline['version'], 'experiment': baseline['experiment'], 'dataset_contract': CONTRACT,
                'heads': HEADS, 'overview': OVERVIEW, 'records': rows, 'counts': COUNTS,
                'synthetic_counts': COUNTS, 'seed': SEED, 'validation_is_development': True,
                'excluded_msd_sites': baseline['excluded_msd_sites'], 'baseline_manifest_sha256': DATA_SHA,
                'build_binding_sha256': binding_sha, 'source_hashes': binding['source_hashes'],
                'source_asset_bindings': binding['input_bindings'], 'config': CONFIG,
                'license': baseline['license'] + ' Additional changes: isotropic pixel-cell scaling and structured sheet nuisance ink.',
                'runtime': runtime(), 'all_space_scoring_eligible': False, 'physical_room_ground_truth_certified': False,
                'human_completeness_evidence': False, 'approved_for_production': False,
                'references_in_source_coordinates': True, 'room_truth_member': 'absent',
                'target_provenance': {'interior': 'derived indoor mask; mixed transformed pixels unknown',
                                      'boundary': 'any-overlap transformed original physical wall/window/door raster footprints',
                                      'opening_closure': 'any-overlap transformed original real door raster footprints only',
                                      'known': 'any contributing source unknown is unknown; mixed interior edges unknown',
                                      'truth': 'not created; no independently complete physical-room reference'},
                'wall_seconds': time.monotonic() - started, 'training_runs': 0, 'inference_runs': 0}
    write(OUTPUT / 'manifest.json', manifest)
    emitted[str((OUTPUT / 'manifest.json').resolve())] = digest(OUTPUT / 'manifest.json')
    if runtime() != binding['runtime'] or sources() != binding['source_hashes']:
        raise ValueError('Source/runtime changed before completion')
    verify(emitted)
    verify(binding['input_bindings']); verify(binding['baseline_bindings'])
    if digest(OUTPUT / 'binding.json') != binding_sha or digest(audit_path) != audit_sha or digest(CLAIM) != claim_sha:
        raise ValueError('Late binding/audit/claim byte change')
    archived_sources(binding)
    verify(emitted)
    write(OUTPUT / 'completed.json', {'contract': CONTRACT, 'output': str(OUTPUT.resolve()),
          'binding_sha256': binding_sha, 'audit_clear_sha256': audit_sha, 'claim_sha256': claim_sha,
          'manifest_sha256': digest(OUTPUT / 'manifest.json'), 'emitted_hashes': emitted,
          'runtime': binding['runtime'], 'source_hashes': binding['source_hashes'],
          'training_runs': 0, 'inference_runs': 0, 'all_space_scoring_eligible': False,
          'physical_room_ground_truth_certified': False, 'human_completeness_evidence': False,
          'approved_for_production': False})
    completed_sha = digest(OUTPUT / 'completed.json')
    verify(emitted); archived_sources(binding)
    if digest(OUTPUT / 'binding.json') != binding_sha or digest(CLAIM) != claim_sha or digest(audit_path) != audit_sha:
        raise ValueError('Completion/control drift before original receipt')
    write(RECEIPT, {'contract': CONTRACT, 'output': str(OUTPUT.resolve()), 'binding_sha256': binding_sha,
          'completed_sha256': completed_sha, 'manifest_sha256': emitted[str((OUTPUT / 'manifest.json').resolve())],
          'claim_sha256': claim_sha, 'audit_clear_sha256': audit_sha, 'runtime': binding['runtime'],
          'source_hashes': binding['source_hashes'], 'emitted_hashes': emitted,
          'all_space_scoring_eligible': False, 'physical_room_ground_truth_certified': False,
          'human_completeness_evidence': False, 'approved_for_production': False})
    original_receipt_sha = digest(RECEIPT)
    verify(emitted); archived_sources(binding)
    if (digest(OUTPUT / 'completed.json') != completed_sha or digest(RECEIPT) != original_receipt_sha
            or digest(OUTPUT / 'binding.json') != binding_sha or digest(CLAIM) != claim_sha or digest(audit_path) != audit_sha
            or runtime() != binding['runtime'] or sources() != binding['source_hashes']):
        raise ValueError('Late completion/source/runtime change')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=('freeze', 'build'))
    args = parser.parse_args(); os.umask(0o077)
    freeze() if args.phase == 'freeze' else build()
