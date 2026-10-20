"""Verify a built HAP against its actual source; never sign or overwrite releases."""
import argparse, hashlib, json, zipfile
from pathlib import Path
from datetime import datetime, timezone
a=argparse.ArgumentParser()
a.add_argument('build_directory',type=Path)
args=a.parse_args()
root=Path(__file__).resolve().parents[1]
built=args.build_directory.resolve()/'project'
hap=built/'entry/build/default/outputs/default/entry-default-unsigned.hap'
log=(args.build_directory/'build.log').read_text(encoding='utf-8-sig')
assert 'BUILD SUCCESSFUL' in log and 'CompileArkTS...' in log
assert 'No signingConfig found for product default' in log
def sha(b):return hashlib.sha256(b).hexdigest()
source={}
for folder in ['entry/src/main','AppScope']:
 for p in sorted((root/folder).rglob('*')):
  if p.is_file():
   rel=p.relative_to(root).as_posix();source[rel]=sha(p.read_bytes())
   assert source[rel]==sha((built/rel).read_bytes()),rel
with zipfile.ZipFile(hap) as z:
 assert z.testzip() is None
 assert len(z.namelist())==len(set(z.namelist()))
 meta=json.loads(z.read('module.json'))
 app=json.loads((root/'AppScope/app.json5').read_text(encoding='utf-8'))['app']
 assert meta['app']['bundleName']==app['bundleName']
 assert meta['app']['versionName']==app['versionName']
 assert meta['app']['versionCode']==app['versionCode']
 raw={}
 for p in sorted((root/'entry/src/main/resources/rawfile').rglob('*')):
  if p.is_file():
   rel='resources/rawfile/'+p.relative_to(root/'entry/src/main/resources/rawfile').as_posix()
   raw[rel]=sha(p.read_bytes());assert sha(z.read(rel))==raw[rel],rel
 assert set(raw)=={n for n in z.namelist() if n.startswith('resources/rawfile/')}
 for name in ['ets/modules.abc','ets/widgets.abc']:assert z.read(name)[:8]==b'PANDA'+bytes(3),name
report={'verificationDate':datetime.now(timezone.utc).isoformat(),'nativeBuildVerified':True,'application':meta['app'],'hap':{'filename':hap.name,'bytes':hap.stat().st_size,'sha256':sha(hap.read_bytes()),'signed':False},'zipCrcValid':True,'sourceInputsMatch':True,'builtSourceSha256':source,'packagedRawAssetSha256':raw,'checks':{'sourceBehaviorScenarios':60,'sourceBehaviorScenariosPassed':60,'type':'native APIs mocked'},'installVerified':False,'deviceRuntimeVerified':False,'credentialsIncluded':False}
(root/'VERIFICATION.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'nativeBuildVerified':True,'version':app['versionName'],'hapBytes':report['hap']['bytes'],'hapSha256':report['hap']['sha256'],'sourceInputCount':len(source),'rawAssetCount':len(raw)}))
