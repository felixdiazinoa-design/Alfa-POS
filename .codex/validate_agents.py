#!/usr/bin/env python3
"""Validate standalone Codex profiles, narrative parity and local Markdown links."""
from pathlib import Path
import json
import re
import tomllib
import urllib.parse

root = Path(__file__).resolve().parent.parent
matrix = json.loads((root / '.codex/risk-matrix.json').read_text())
base = {'orchestrator', 'analyst', 'developer', 'reviewer', 'qa', 'integration', 'performance', 'security', 'release'}
extra = {'ALFA-RMS': {'data-integrity'}, 'ALFA-POS': {'sync-validator', 'offline-validator', 'internal-deploy'}, 'ALFA-ADMIN': {'tenant-integrity'}}
expected = base | extra[matrix['product']]
actual = {file.stem for file in (root / '.codex/agents').glob('*.toml')}
assert actual == expected, f'Roles missing/unexpected: {expected ^ actual}'
for name in sorted(expected):
    profile = tomllib.loads((root / f'.codex/agents/{name}.toml').read_text())
    assert profile['name'] == name
    assert profile['description'].strip()
    assert profile['developer_instructions'] == (root / f'.codex/agents/{name}.md').read_text(), f'MD/TOML drift: {name}'
    assert 'model' not in profile, 'Preserve parent model unless explicitly requested'
for gate in {gate for rule in matrix['rules'] for gate in rule['gates']}:
    assert gate in expected, f'Undefined gate: {gate}'
files = [root / 'AGENTS.md', root / 'WORKFLOW.md']
files += list((root / '.codex').rglob('*.md')) + list((root / 'docs/architecture').glob('*.md'))
for file in files:
    for link in re.findall(r'\[[^\]]*\]\(([^)]+)\)', file.read_text()):
        if '://' in link or link.startswith('#'): continue
        target = urllib.parse.unquote(link.split('#')[0]).strip('<>')
        target = re.sub(r':\d+$', '', target)
        assert (file.parent / target).exists(), f'Broken link {file}: {link}'
print(f'PASS {matrix["product"]}: {len(expected)} profiles, parity, matrix gates and local links')
