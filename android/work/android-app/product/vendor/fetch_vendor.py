"""Fetch only missing, hash-pinned OCR inputs/licenses, then verify them offline.

Existing mismatches are errors and are never silently replaced. Network access is
only used by this explicitly invoked script; build.py never downloads anything.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import urllib.request
import zipfile
from verify_vendor import verify_vendor

VENDOR = Path(__file__).resolve().parent


def fetch(target, url, expected):
    if target.exists():
        if hashlib.sha256(target.read_bytes()).hexdigest() != expected:
            raise ValueError('Existing dependency hash mismatch; inspect it before replacing: ' + target.name)
        return
    if not url.startswith('https://'):
        raise ValueError('Dependency downloads require HTTPS')
    target.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={'User-Agent': 'Suike-offline-OCR-vendor-fetch/1'})
    with urllib.request.urlopen(request, timeout=120) as response:
        data = response.read(64 * 1024 * 1024 + 1)
    if len(data) > 64 * 1024 * 1024 or hashlib.sha256(data).hexdigest() != expected:
        raise ValueError('Downloaded dependency hash mismatch: ' + target.name)
    temporary = target.with_suffix(target.suffix + '.download')
    try:
        temporary.write_bytes(data)
        os.replace(temporary, target)
    finally:
        if temporary.exists():
            temporary.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify-only', action='store_true', help='No network, fail if an input is absent or altered')
    parser.add_argument('--json', type=Path)
    args = parser.parse_args()
    if not args.verify_only:
        lock = json.loads((VENDOR / 'lock.json').read_text(encoding='utf-8'))
        aar_spec, model_spec = lock['tesseract4android'], lock['chi_sim']
        aar = VENDOR / ('tesseract4android-' + aar_spec['version'] + '.aar')
        fetch(aar, aar_spec['url'], aar_spec['sha256'])
        fetch(VENDOR / 'chi_sim.traineddata', model_spec['url'], model_spec['sha256'])
        with zipfile.ZipFile(aar) as archive:
            expected = archive.read('classes.jar')
        jar = VENDOR / 'classes.jar'
        if jar.exists() and jar.read_bytes() != expected:
            raise ValueError('Existing classes.jar differs from pinned AAR')
        if not jar.exists():
            jar.write_bytes(expected)
        licenses = json.loads((VENDOR / 'licenses.lock.json').read_text(encoding='utf-8'))
        for spec in licenses['licenses']:
            if Path(spec['file']).name != spec['file']:
                raise ValueError('Unsafe license filename')
            fetch(VENDOR / 'licenses' / spec['file'], spec['url'], spec['sha256'])
    result = verify_vendor()
    encoded = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(encoded, encoding='utf-8')
    print(encoded)


if __name__ == '__main__':
    main()
