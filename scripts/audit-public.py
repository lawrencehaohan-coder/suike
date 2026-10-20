from pathlib import Path
import re,sys

root=Path(__file__).resolve().parents[1]
bad=[];count=0
private_extensions={'.p12','.pfx','.jks','.keystore','.key','.pem','.cer','.crt'}
text_extensions={'.html','.js','.cjs','.mjs','.ts','.ets','.json','.json5','.css','.py','.ps1','.md','.txt','.xml','.webmanifest','.csv','.svg','.yml','.yaml'}
patterns=[('private key',re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----')),('GitHub token',re.compile(r'(?:gh[pousr]_[A-Za-z0-9]{24,}|github_pat_[A-Za-z0-9_]{30,})')),('API key',re.compile(r'sk-[A-Za-z0-9]{32,}')),('AWS credential identifier',re.compile(r'AKIA[0-9A-Z]{16}'))]
for p in root.rglob('*'):
    rel=p.relative_to(root)
    if not p.is_file() or any(x in {'.git','node_modules','build','oh_modules','.hvigor','__pycache__'} for x in rel.parts):continue
    count+=1
    if p.suffix.lower() in private_extensions or p.name.startswith('.env') or 'signing-password' in p.name:bad.append((str(rel),'credential file'))
    if p.stat().st_size>95*1024*1024:bad.append((str(rel),'file exceeds 95 MiB'))
    if p.suffix.lower() not in text_extensions:continue
    try:text=p.read_text(encoding='utf-8-sig')
    except UnicodeError:continue
    is_test=any('test' in x.lower() for x in rel.parts)
    for name,pattern in patterns:
        if pattern.search(text) and not (is_test and name=='API key'):bad.append((str(rel),name))
if bad:
    for file,reason in bad:print(f'{file}: {reason}')
    sys.exit(1)
print(f'Public-source audit passed: {count} files; no credential files, detected live tokens or oversized GitHub files.')
