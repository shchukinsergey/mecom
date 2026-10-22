"""Verify the three v3 templates against original SN2 files; never writes originals.

Usage: python scripts/verify-scenario-durations.py PATH_TO_ORIGINAL_SCENARIO_DIRECTORY
Duration is established by the FIRST explicit numbered completion message, not
by populated numeric slots: later slots contain leftover shared template data.
"""
import importlib.util
import json
from pathlib import Path
import re
import sys

spec = importlib.util.spec_from_file_location('decoder', Path(__file__).with_name('decode-scenarios.py'))
decoder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(decoder)
source = Path(sys.argv[1])
templates = Path(__file__).resolve().parents[1] / 'src/engine/scenarios'
ending = re.compile(r'(?:ПЕРИОД\s*№?\s*(\d+)|(\d+)\s*ПЕРИОД)\s*БЫЛ\s*ПОСЛЕДНИМ', re.I)
for name, original in [('tractors', 'tractory'), ('ipad', 'ipad'), ('emobile', 'emobile')]:
    path = next(p for p in source.iterdir() if p.stem.lower() == original and p.suffix.lower() == '.sn2')
    decoded = decoder.decode(path)
    template = json.loads((templates / f'{name}-v3.json').read_text(encoding='utf-8'))
    slot, match = next((i, ending.search(p['news'])) for i, p in enumerate(decoded['periods']) if ending.search(p['news']))
    duration = int(match.group(1) or match.group(2))
    assert slot == duration == template['playablePeriods'], name
    assert template['sourceSha256'] == decoded['sha256'], name
    assert template['globals'] == decoded['globalFloatSlots'], name
    assert template['completionNews'] == decoded['periods'][duration]['news'], name
    assert template['periods'] == [{'values': p['rawFloatSlots'], 'news': p['news']} for p in decoded['periods'][:duration]], name
    print(f'{name}: {duration} playable periods; all globals, period values and news verified')
