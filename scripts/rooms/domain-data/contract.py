"""Fixed-source/setting/path contracts for one separately audited CPU data build."""
import hashlib
from importlib.metadata import version
import json
from pathlib import Path
import shutil
import sys

from render import (CLOUDS, DENSITIES, HEIGHT, MAX_FIXTURES, MAX_PARKING, MAX_VOID_PARKING,
                    OVERVIEW, REGION, VOID_MARGIN, WIDTH, density_schedule)

DATA = Path('/home/tim/datasets/foremanhq-room-detection/models/data-swiss-true-openings-v4-20260930/manifest.json')
DATA_SHA = '619fc06189bd9b6ba1b723ca88c403f89a2ed31c86f628a91408482d9e3fc86b'
OUTPUT = Path('/home/tim/datasets/foremanhq-room-detection/domain-data/swiss-domain-scale-v1-20260930')
CLAIM = OUTPUT.parent / 'swiss-domain-scale-v1-20260930.build.claim.json'
RECEIPT = OUTPUT.parent / 'swiss-domain-scale-v1-20260930.completed.json'
CONTRACT = 'swiss-domain-scale-and-structured-sheet-v1'
COUNTS = {'train': 80, 'validation': 20}
SEED = 20260930
HEADS = ['interior', 'boundary', 'opening_closure']
CONFIG = {'contract': CONTRACT, 'width': WIDTH, 'height': HEIGHT, 'overview': OVERVIEW,
          'densities': list(DENSITIES), 'source_copies_per_page': 1, 'placement_region': list(REGION),
          'seed': SEED, 'maximum_new_fixtures': MAX_FIXTURES, 'maximum_parking': MAX_PARKING,
          'maximum_known_negative_pocket_motifs': MAX_VOID_PARKING, 'pocket_positive_unknown_clearance': VOID_MARGIN,
          'clouds': CLOUDS, 'physical_targets': 'any-overlap rational pixel-cell support',
          'unknown': 'any contributing unknown propagates; mixed interior cells unsupervised',
          'physical_room_ground_truth_certified': False, 'all_space_scoring_eligible': False}


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1048576), b''):
            h.update(block)
    return h.hexdigest()


def write(path, value):
    with Path(path).open('x') as f:
        json.dump(value, f, indent=2, allow_nan=False)
    Path(path).chmod(0o600)


def runtime():
    return {'python': sys.version.split()[0], **{p: version(p) for p in ('numpy', 'Pillow', 'scipy')}}


def sources():
    directory = Path(__file__).resolve().parent
    return {p.name: digest(p) for p in sorted(directory.iterdir()) if p.suffix == '.py' or p.name == 'README.md'}


def verify(entries):
    for name, sha in entries.items():
        if digest(name) != sha:
            raise ValueError('Frozen domain-data bytes changed: ' + name)


def archived_sources(binding, output=OUTPUT):
    verify({str(output / 'frozen-sources' / name): sha for name, sha in binding['source_hashes'].items()})


def asset(root, name, sha):
    if not isinstance(name, str) or Path(name).is_absolute() or not isinstance(sha, str) or len(sha) != 64:
        raise ValueError('Hashed relative asset required')
    path = (root / name).resolve(strict=True)
    if not path.is_relative_to(root.resolve()) or digest(path) != sha:
        raise ValueError('Domain baseline asset escape or byte drift')
    return path


def validate_metadata(data):
    if (data.get('dataset_contract') != 'swiss-true-openings-ink-v4'
            or data.get('version') != 'structural-room-challenger-v1'
            or data.get('experiment') != 'whole-sheet-context-v2'
            or data.get('heads') != HEADS or data.get('overview') != OVERVIEW
            or data.get('all_space_scoring_eligible') is not False
            or data.get('physical_room_ground_truth_certified') is not False
            or data.get('human_completeness_evidence') is not False):
        raise ValueError('Exact generated head-only v4 contract required')
    records = data.get('records', [])
    if len(records) != 100 or {s: sum(r.get('split') == s for r in records) for s in COUNTS} != COUNTS:
        raise ValueError('Same complete v4 80/20 records required')
    ids, groups, sites, source_rows, images = set(), {}, {}, {}, {}
    excluded = {str(s) for s in data.get('excluded_msd_sites', [])}
    for r in records:
        ident, split = r['id'], r['split']
        if not isinstance(ident, str) or not ident or Path(ident).name != ident or ident in ids:
            raise ValueError('Unique plain source IDs required')
        ids.add(ident)
        if (r.get('source') != 'swiss-dwellings-real-geometry' or not r.get('component_aliases')
                or str(r.get('site')) in excluded or r['render_stats'].get('all_space_scoring_eligible') is not False
                or r['render_stats'].get('physical_room_ground_truth_certified') is not False
                or r['render_stats'].get('real_door_coordinates') is not True):
            raise ValueError('Protected, unknown or certified-room source rejected')
        for mapping, key in ((groups, r['group']), (sites, str(r['site'])),
                             (source_rows, r['source_row_snapshot_sha256']), (images, r['image_sha256'])):
            if not key or mapping.setdefault(key, split) != split:
                raise ValueError('Source/group/site/image identity crosses development split')
        for alias in r['component_aliases']:
            if groups.setdefault('alias:' + json.dumps(alias, sort_keys=True), split) != split:
                raise ValueError('Source component alias crosses split')
    if len({r['group'] for r in records}) != 100:
        raise ValueError('Expected independently pinned source components')
    return records


def source_metadata():
    if digest(DATA) != DATA_SHA:
        raise ValueError('Source manifest is not the independently frozen Swiss v4')
    value = json.loads(DATA.read_text())
    records = validate_metadata(value)
    if digest(DATA) != DATA_SHA:
        raise ValueError('Source manifest changed during metadata decode')
    return value, records


def freeze():
    """Preserve all baseline bytes and sources before any asset decoding.

    This phase copies existing native assets; it does not render a new page.
    Its execution still requires root authorization, separate from writing code.
    """
    frozen_sources, versions = sources(), runtime()
    data, records = source_metadata()
    if runtime() != versions or sources() != frozen_sources:
        raise ValueError('Source/runtime changed during metadata eligibility preflight')
    entries = {str(DATA.resolve()): DATA_SHA}
    for r in records:
        for key in ('image', 'targets', 'overview', 'references'):
            path = asset(DATA.parent, r[key], r[key + '_sha256'])
            entries[str(path)] = r[key + '_sha256']
    if len(entries) != 401:
        raise ValueError('Exactly manifest plus400 native baseline assets required')
    OUTPUT.mkdir(mode=0o700, parents=True, exist_ok=False)
    baseline, archive = OUTPUT / 'baseline', OUTPUT / 'frozen-sources'
    baseline.mkdir(mode=0o700); archive.mkdir(mode=0o700)
    copies = {}
    for name, sha in entries.items():
        path = Path(name); dest = baseline / path.relative_to(DATA.parent.resolve())
        dest.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        shutil.copyfile(path, dest); dest.chmod(0o600)
        if digest(dest) != sha:
            raise ValueError('Baseline raw-byte preservation failed')
        copies[str(dest.resolve())] = sha
    for name, sha in frozen_sources.items():
        dest = archive / name
        shutil.copyfile(Path(__file__).resolve().parent / name, dest); dest.chmod(0o600)
        if digest(dest) != sha:
            raise ValueError('Source snapshot changed during freeze')
    verify(entries); verify(copies)
    if runtime() != versions or sources() != frozen_sources:
        raise ValueError('Source/runtime changed during preflight freeze')
    binding = {'contract': CONTRACT, 'output': str(OUTPUT.resolve()), 'config': CONFIG,
               'data': str(DATA.resolve()), 'data_sha256': DATA_SHA, 'runtime': versions,
               'source_hashes': frozen_sources, 'input_bindings': entries, 'baseline_bindings': copies,
               'density_schedule': density_schedule(records), 'original_ids': sorted(r['id'] for r in records),
               'split_counts': COUNTS, 'references_are_baseline_source_coordinates': True,
               'physical_room_ground_truth_certified': False, 'all_space_scoring_eligible': False}
    write(OUTPUT / 'binding.json', binding)
    binding_sha = digest(OUTPUT / 'binding.json')
    verify(entries); verify(copies); archived_sources(binding)
    if (sources() != frozen_sources or runtime() != versions
            or digest(OUTPUT / 'binding.json') != binding_sha):
        raise ValueError('Late source/runtime/binding change during freeze')
    return binding


def read_binding(output=OUTPUT):
    if output.resolve() != OUTPUT.resolve():
        raise ValueError('Original frozen output path required; copies cannot build')
    path = output / 'binding.json'; pin = digest(path)
    binding = json.loads(path.read_text())
    if (binding.get('contract') != CONTRACT or binding.get('output') != str(OUTPUT.resolve())
            or binding.get('data') != str(DATA.resolve()) or binding.get('data_sha256') != DATA_SHA
            or binding.get('config') != CONFIG or binding.get('runtime') != runtime()
            or binding.get('source_hashes') != sources()
            or binding.get('all_space_scoring_eligible') is not False):
        raise ValueError('Frozen build identity/config/source/runtime changed')
    data, records = source_metadata()
    expected = {str(DATA.resolve()): DATA_SHA}
    copied = {str((output / 'baseline/manifest.json').resolve()): DATA_SHA}
    for r in records:
        for key in ('image', 'targets', 'overview', 'references'):
            original = asset(DATA.parent, r[key], r[key + '_sha256'])
            clone = asset(output / 'baseline', r[key], r[key + '_sha256'])
            expected[str(original)] = copied[str(clone)] = r[key + '_sha256']
    if (binding.get('input_bindings') != expected or binding.get('baseline_bindings') != copied
            or binding.get('original_ids') != sorted(r['id'] for r in records)
            or binding.get('density_schedule') != density_schedule(records)
            or binding.get('split_counts') != COUNTS):
        raise ValueError('Incomplete or substituted source/schedule association')
    archived_sources(binding, output)
    verify(expected); verify(copied)
    if digest(path) != pin or runtime() != binding['runtime'] or sources() != binding['source_hashes']:
        raise ValueError('Binding/source/runtime drift during preflight')
    return binding, data, records, pin


def audit_clear(binding, binding_sha):
    path = OUTPUT / 'AUDIT_CLEAR.json'
    pin = digest(path)
    value = json.loads(path.read_text())
    if (value.get('outcome') != 'CLEAR' or value.get('scope') != 'one-fixed-domain-data-build'
            or value.get('binding_sha256') != binding_sha
            or value.get('source_hashes') != binding['source_hashes']
            or not value.get('reviewer') or digest(path) != pin):
        raise ValueError('Independent frozen-source build audit clearance required')
    return path, pin


def claim(binding_sha, audit_sha):
    CLAIM.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    value = {'contract': CONTRACT, 'output': str(OUTPUT.resolve()), 'binding_sha256': binding_sha,
             'data_sha256': DATA_SHA, 'config': CONFIG, 'audit_clear_sha256': audit_sha}
    write(CLAIM, value)
    return digest(CLAIM)


def completed_build(output=OUTPUT):
    """Executable completion gate required before any later training adapter.

    No raster/NPZ/model is decoded. Both pre/post bytes and the exact native
    associations are checked rather than trusting an arbitrary hash dictionary.
    """
    binding, _, originals, binding_sha = read_binding(output)
    done_path, manifest_path = output / 'completed.json', output / 'manifest.json'
    global_receipt_sha = digest(RECEIPT); global_done = json.loads(RECEIPT.read_text())
    done_sha = digest(done_path)
    if global_done.get('completed_sha256') != done_sha:
        raise ValueError('Completion differs from original global emission receipt')
    done = json.loads(done_path.read_text())
    if (done.get('contract') != CONTRACT or done.get('output') != str(OUTPUT.resolve())
            or done.get('binding_sha256') != binding_sha or done.get('runtime') != binding['runtime']
            or done.get('source_hashes') != binding['source_hashes']
            or done.get('training_runs') != 0 or done.get('inference_runs') != 0
            or done.get('all_space_scoring_eligible') is not False
            or done.get('physical_room_ground_truth_certified') is not False
            or done.get('human_completeness_evidence') is not False
            or done.get('approved_for_production') is not False
            or done.get('manifest_sha256') != digest(manifest_path)):
        raise ValueError('Exact completed generated-data identity required')
    audit_path, audit_sha = audit_clear(binding, binding_sha)
    claim_sha = digest(CLAIM); claim_value = json.loads(CLAIM.read_text())
    expected_claim = {'contract': CONTRACT, 'output': str(OUTPUT.resolve()), 'binding_sha256': binding_sha,
                      'data_sha256': DATA_SHA, 'config': CONFIG, 'audit_clear_sha256': audit_sha}
    if (claim_value != expected_claim or done.get('claim_sha256') != claim_sha
            or done.get('audit_clear_sha256') != audit_sha):
        raise ValueError('Original consumed build claim/audit association required')
    expected_global = {'contract': CONTRACT, 'output': str(OUTPUT.resolve()), 'binding_sha256': binding_sha,
                       'completed_sha256': done_sha, 'manifest_sha256': done['manifest_sha256'],
                       'claim_sha256': claim_sha, 'audit_clear_sha256': audit_sha,
                       'runtime': binding['runtime'], 'source_hashes': binding['source_hashes'],
                       'all_space_scoring_eligible': False, 'physical_room_ground_truth_certified': False,
                       'human_completeness_evidence': False, 'approved_for_production': False,
                       'emitted_hashes': done.get('emitted_hashes')}
    if global_done != expected_global:
        raise ValueError('Original global completion/output/source ledger required')
    manifest = json.loads(manifest_path.read_text())
    if (manifest.get('version') != 'structural-room-challenger-v1'
            or manifest.get('experiment') != 'whole-sheet-context-v2' or manifest.get('heads') != HEADS
            or manifest.get('overview') != OVERVIEW
            or manifest.get('dataset_contract') != CONTRACT or manifest.get('baseline_manifest_sha256') != DATA_SHA
            or manifest.get('build_binding_sha256') != binding_sha or manifest.get('config') != CONFIG
            or manifest.get('counts') != COUNTS or manifest.get('runtime') != binding['runtime']
            or manifest.get('source_hashes') != binding['source_hashes']
            or manifest.get('all_space_scoring_eligible') is not False
            or manifest.get('physical_room_ground_truth_certified') is not False
            or manifest.get('human_completeness_evidence') is not False
            or manifest.get('room_truth_member') != 'absent'
            or manifest.get('training_runs') != 0 or manifest.get('inference_runs') != 0):
        raise ValueError('Manifest cannot certify physical-room completeness')
    rows = manifest.get('records', [])
    reference = {r['id']: r for r in originals}
    if len(rows) != 100 or {r.get('id') for r in rows} != set(reference):
        raise ValueError('Completed source coverage differs from original100')
    emitted = {str(manifest_path.resolve()): done['manifest_sha256']}
    for row in rows:
        original = reference[row['id']]
        for key in ('site', 'group', 'split', 'building', 'floor', 'plan', 'source', 'component_aliases', 'source_row_snapshot_sha256'):
            if row.get(key) != original.get(key):
                raise ValueError('Completed record changes original source association')
        if (row['render_stats'].get('density') != binding['density_schedule'][row['id']]
                or row['render_stats'].get('all_space_scoring_eligible') is not False
                or row['render_stats'].get('physical_room_ground_truth_certified') is not False
                or row['render_stats'].get('human_completeness_evidence') is not False
                or row['render_stats'].get('approved_for_production') is not False):
            raise ValueError('Completed record changes scale or room-truth contract')
        paths = {'image': row['id'] + '.png', 'targets': row['id'] + '.npz',
                 'overview': row['id'] + '-overview.npz', 'references': row['id'] + '.references.json'}
        for key, name in paths.items():
            if row.get(key) != 'assets/' + name:
                raise ValueError('Completed record substitutes asset path')
            path = asset(output, row[key], row[key + '_sha256'])
            emitted[str(path)] = row[key + '_sha256']
        if row['references_sha256'] != original['references_sha256']:
            raise ValueError('Completed source reference was rewritten')
        receipt = output / 'assets' / (row['id'] + '.receipt.json')
        page_receipt_sha = digest(receipt); content = json.loads(receipt.read_text())
        base_sha = hashlib.sha256(json.dumps(original, sort_keys=True).encode()).hexdigest()
        expected_receipt = {'id': row['id'], 'split': row['split'], 'group': row['group'],
                            'baseline_record_sha256': base_sha,
                            'baseline_asset_hashes': {key: original[key + '_sha256'] for key in paths},
                            'output_hashes': {key: row[key + '_sha256'] for key in paths},
                            'density': binding['density_schedule'][row['id']],
                            'physical_room_ground_truth_certified': False, 'all_space_scoring_eligible': False}
        if content != expected_receipt or row.get('baseline_record_sha256') != base_sha:
            raise ValueError('Per-page receipt/source/output association changed')
        emitted[str(receipt.resolve())] = page_receipt_sha
    if done.get('emitted_hashes') != emitted or len(emitted) != 501:
        raise ValueError('Missing/substituted completed output hashes')
    verify(binding['input_bindings']); verify(binding['baseline_bindings']); archived_sources(binding, output)
    if (digest(done_path) != done_sha or digest(output / 'binding.json') != binding_sha
            or digest(CLAIM) != claim_sha or digest(audit_path) != audit_sha or digest(RECEIPT) != global_receipt_sha
            or runtime() != binding['runtime'] or sources() != binding['source_hashes']):
        raise ValueError('Completion byte/source/runtime drift during metadata decode')
    verify(emitted); archived_sources(binding, output)
    if (digest(done_path) != done_sha or digest(RECEIPT) != global_receipt_sha
            or digest(output / 'binding.json') != binding_sha or digest(CLAIM) != claim_sha
            or digest(audit_path) != audit_sha or sources() != binding['source_hashes']
            or runtime() != binding['runtime']):
        raise ValueError('Late completed/control byte drift')
    return manifest, done
