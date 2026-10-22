"""Read MECOM 2.07 SN2 files without modifying originals (stdlib only).

Usage: python scripts/decode-scenarios.py SOURCE_DIR OUTPUT_DIR
Outputs research JSON, not importable league snapshots. Unmapped slots are retained.
"""
from pathlib import Path
import argparse
import hashlib
import json
import struct

PASSWORD = b'NightMare unLimited Group'


def transform(data):
    return bytes(value ^ PASSWORD[pos % 25]
                 ^ (((pos % 59 + 7) << 2) & 255)
                 ^ ((pos % 61 * 3) & 255) ^ (pos & 255)
                 for pos, value in enumerate(data))


def decode(path):
    original = path.read_bytes()
    if len(original) != 13846:
        return {'file': path.name, 'size': len(original), 'status': 'unsupported-size'}
    data = transform(original)
    periods = []
    for index in range(16):
        start = 534 + index * 192
        slots = list(struct.unpack_from('<48f', data, start))
        rows = []
        for row in range(8):
            offset = 3606 + index * 640 + row * 80
            rows.append(data[offset:offset + 80].split(b'\0', 1)[0].decode('cp866'))
        periods.append({
            'slotIndex': index,
            'loanBase': slots[1], 'loanExtra': slots[2],
            'bankRateBasePercent': slots[3], 'storageCost': slots[0],
            'bankRateExtraPercent': slots[5], 'taxPercent': slots[7],
            'demandControlsCandidate': slots[8:11],
            'marketWeightsCandidate': slots[11:14],
            'firingPenalty': slots[14],
            'rifWeightsCandidate': slots[24:30],
            'news': '\n'.join(rows).strip(), 'rawFloatSlots': slots,
        })
    assert transform(data) == original
    return {'file': path.name, 'size': len(original),
            'sha256': hashlib.sha256(original).hexdigest(),
            'status': 'decoded-standard-layout',
            'note': 'Period slot numbering and candidate field semantics need native UI verification.',
            'globalFloatSlots': list(struct.unpack_from('<128f', data, 22)),
            'periods': periods}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    summary = []
    for path in sorted(args.source.iterdir()):
        if path.suffix.lower() != '.sn2':
            continue
        result = decode(path)
        (args.output / (path.stem + '.json')).write_text(
            json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
        summary.append({key: result[key] for key in ['file', 'size', 'status']})
    (args.output / 'index.json').write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'{len(summary)} files; {sum(x["status"] == "decoded-standard-layout" for x in summary)} standard layouts decoded')
