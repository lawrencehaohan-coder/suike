"""Package the complete port source, excluding SDKs, caches, and signing material."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('output', type=Path, help='New ZIP path outside this source directory')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
output = args.output.resolve()
if output == root or root in output.parents:
    parser.error('Output must be outside the source directory.')
if output.exists():
    parser.error('Output already exists; choose a new file instead of replacing a release.')
excluded_dirs = {'.git', '.hvigor', 'node_modules', 'oh_modules', 'build', '__pycache__', 'signing', 'certificates'}
excluded_suffixes = {'.p12', '.p7b', '.pem', '.cer', '.crt', '.key', '.jks', '.keystore', '.pyc', '.log'}
files = []
manifest = {}
for file in sorted(root.rglob('*')):
    relative = file.relative_to(root)
    if any(part in excluded_dirs for part in relative.parts):
        continue
    if file.is_symlink():
        raise RuntimeError('Unexpected source symlink: ' + relative.as_posix())
    if not file.is_file() or file.suffix.lower() in excluded_suffixes:
        continue
    if file.name in {'local.properties', '.env'} or file.name.startswith('.env.'):
        continue
    data = file.read_bytes()
    files.append((relative.as_posix(), data))
    manifest[relative.as_posix()] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
required = ['AppScope/app.json5', 'build-profile.json5', 'entry/src/main/module.json5',
            'entry/src/main/ets/entryability/EntryAbility.ets', 'entry/src/main/ets/services/NativeDocuments.ets',
            'entry/src/main/resources/rawfile/index.html', 'tools/Build-Unsigned.ps1',
            'tools/Test-Sources.ps1', 'README_先读.md', 'README_构建.md', 'BUILD_STATUS.json']
for name in required:
    if name not in manifest:
        raise RuntimeError('Required source missing: ' + name)
output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for name, data in files:
        archive.writestr('suike-harmony/' + name, data)
    archive.writestr('suike-harmony/SOURCE_FILES_SHA256.json',
                     json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
with zipfile.ZipFile(output) as archive:
    bad = archive.testzip()
    if bad:
        raise RuntimeError('ZIP integrity check failed: ' + bad)
    for name, expected in manifest.items():
        if hashlib.sha256(archive.read('suike-harmony/' + name)).hexdigest() != expected['sha256']:
            raise RuntimeError('Source verification failed: ' + name)
print(json.dumps({'file': str(output), 'sourceFileCount': len(manifest), 'bytes': output.stat().st_size,
                  'sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'zipCrcValid': True},
                 ensure_ascii=False))
