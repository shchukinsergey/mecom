"""Audit original starting parameters and their native editor labels, read-only.

python scripts/audit-original-scenarios.py ORIGINAL_MECOM_DIRECTORY OUTPUT_JSON
No dependencies outside the Python standard library. Does not run the EXE.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import runpy
import struct

RESOURCE_KEY = b'Multi Adapter/Language Engine CRC (c) 1997-98 by Alexander Babanov'
FIELDS = [0, 1, 2, 3, 4, 8, 9, 10, 11, 12, 13, 14, 25, 26, 27,
          30, 31, 32, 33, 34, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45,
          60, 61, 62, 64, 65, 66, 74, 75, 76, 77, 78, 84]

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    transform = runpy.run_path(str(Path(__file__).with_name('decode-scenarios.py')))['transform']
    encrypted = (args.source / 'LANGUAGE/RUSSIAN.MMP').read_bytes()
    language = bytes(v ^ RESOURCE_KEY[(i + 3) % len(RESOURCE_KEY)]
                     ^ (((i + 3) * 59 + 7) & 255) ^ (((i + 3) * 61) & 255) ^ 85
                     for i, v in enumerate(encrypted)).decode('cp866')
    labels = {int(index): label for index, label in re.findall(r'GA_a(\d{3})\x00([^\x00]+)', language)}
    assert 'октет' in labels[27]
    result = {'method': 'SN2 values + decrypted native editor labels; not a DOSBox runtime test',
              'exeSha256': hashlib.sha256((args.source / 'Mecompro.exe').read_bytes()).hexdigest(),
              'scenarios': {}}
    for name in ['tractory', 'ipad', 'emobile']:
        original = (args.source / 'scenario' / (name + '.SN2')).read_bytes()
        assert len(original) == 13846
        decoded = transform(original)
        assert transform(decoded) == original
        globals_ = struct.unpack_from('<128f', decoded, 22)
        result['scenarios'][name] = {
            'sourceSha256': hashlib.sha256(original).hexdigest(),
            'fields': {f'ALL{i:03}': {'label': labels.get(i), 'value': globals_[i]} for i in FIELDS},
            'eightFirmExample': {
                'capacityPerFirm': globals_[25] / 8,
                'productionPerFirm': globals_[25] / 8 * globals_[31] / 100,
                'openingInventoryPerFirm': globals_[27] / 8,
                'marketingPerFirm': globals_[32] / 8,
                'additionalCapexPerFirm': globals_[33] / 8,
                'rndPerFirm': globals_[34] / 8,
            },
        }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print('Verified labels and starting fields for 3 original SN2 scenarios.')
