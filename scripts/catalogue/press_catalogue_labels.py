"""Keep catalogue labels concise and preserve manufacturer identifiers in aliases."""
import re

PROVENANCE_SENTENCE = 'Listed in manufacturer catalogue'


def clean_press_row(row):
    row = dict(row)
    source_description = row['manufacturerDescription']
    product = source_description.split(' - ')[0]
    base = re.sub(r'^Viega MegaPressG? ', '', product).strip().lower()
    assert base != product.lower(), product
    ends = row['connections']
    sizes = set(ends.values())
    if base == 'adapter':
        assert ('MPT' in ends) != ('FPT' in ends), row['sku']
        basic = 'Male Adapter' if 'MPT' in ends else 'Female Adapter'
    elif base == 'reducer':
        basic = 'Street Reducer' if 'FTG (IPS)' in ends else 'Reducer'
    elif base == 'tee':
        basic = 'Female Threaded Tee' if 'FPT' in ends else 'Tee'
        if len(sizes) > 1:
            basic = 'Reducing ' + basic
    elif base == 'union' and 'FPT' in ends:
        basic = 'Female Threaded Union'
    elif base in ['coupling', 'extended coupling']:
        assert 'No stop' in source_description or 'With stop' in source_description, row['sku']
        basic = ('Extended ' if base.startswith('extended') else '') + ('No-Stop Coupling' if 'No stop' in source_description else 'Coupling')
    elif base == 'flange':
        if 'Flat Face' in source_description:
            basic = 'Flat Face Flange'
        elif 'Raised Face' in source_description:
            basic = 'Raised Face Flange'
        else:
            basic = 'Flange'
    else:
        assert base in ['cap', 'union', 'slip coupling', 'transition coupling', '45° elbow', '90° elbow', '45° street elbow', '90° street elbow'], base
        basic = base.title()
    aliases = list(row.get('aliases', [])) + [row['displayName']]
    # Keep useful auxiliary facts searchable, without copying provenance boilerplate.
    aliases.extend(piece.strip(' .') for piece in re.split(r'\.\s+', row.get('description', '')) if piece.strip(' .') != PROVENANCE_SENTENCE)
    aliases += [f"Model {row['model']}", f"Manufacturer part number {row['sku']}",
                'Connections: ' + ', '.join(f'{key} {value.replace(chr(34), " in")}' for key, value in ends.items())]
    for key in ['L [mm]', 'INDmin [mm]', 'BP', 'BPd']:
        if key in row['articleData']:
            aliases.append(f"{key}: {row['articleData'][key]}")
    for clause in source_description.split(' - ', 1)[1].split(';'):
        clause = clause.strip()
        if clause and len(clause) <= 255 and clause != 'Smart Connect Technology':
            aliases.append(clause)
    row['displayName'] = f"{row['sizeLabel']} {row['material']} {basic}"
    row['description'] = basic
    row['aliases'] = list(dict.fromkeys(a for a in aliases if a and PROVENANCE_SENTENCE not in a))
    assert all(len(a) <= 255 for a in row['aliases']), row['sku']
    if row.get('availability') == PROVENANCE_SENTENCE:
        row.pop('availability')
    return row
