"""Exercise the packaged app on a guarded local phone emulator, without sending AI requests."""
import argparse,hashlib,json,pathlib,re,subprocess,time
from PIL import Image,ImageStat
a=argparse.ArgumentParser()
a.add_argument('--hdc',required=True)
a.add_argument('--hap',required=True,type=pathlib.Path)
a.add_argument('--output',required=True,type=pathlib.Path)
a.add_argument('--server',default='127.0.0.1:8714')
a.add_argument('--target',default='127.0.0.1:15882')
args=a.parse_args()
if not re.fullmatch(r'127\.0\.0\.1:[0-9]{4,5}',args.target):raise SystemExit('Only a local emulator target is accepted.')
args.output.mkdir(parents=True,exist_ok=True)
prefix=[args.hdc,'-s',args.server,'-t',args.target]
def call(cmd):
 p=subprocess.run(prefix+cmd,capture_output=True,timeout=20)
 out=p.stdout.decode('utf-8','replace')
 if p.returncode or '[Fail]' in out:raise RuntimeError(out[-1000:])
 return out
model=call(['shell','param','get','const.product.model']).strip()
api=call(['shell','param','get','const.ohos.apiversion']).strip()
if model!='emulator' or api!='20':raise SystemExit('Expected the owned API 20 phone emulator.')
call(['shell','aa','force-stop','cn.suike.timetable'])
time.sleep(1)
out=call(['install','-r',str(args.hap.resolve())])
if 'install bundle successfully' not in out:raise RuntimeError(out)
call(['shell','power-shell','wakeup'])
out=call(['shell','aa','start','-a','EntryAbility','-b','cn.suike.timetable'])
if 'start ability successfully' not in out:raise RuntimeError(out)
def layout(label):
 remote='/data/local/tmp/suike-smoke-'+label+'.json'
 call(['shell','uitest','dumpLayout','-p',remote])
 dest=args.output/(label+'.json');call(['file','recv',remote,str(dest)])
 raw=json.loads(dest.read_text(encoding='utf-8'));nodes=[]
 def visit(n):
  if isinstance(n,dict):
   at=n.get('attributes',{})
   if at.get('text'):nodes.append(at)
   for x in n.get('children',[]):visit(x)
 visit(raw);return nodes
def ready(label,condition):
 end=time.monotonic()+45
 while True:
  nodes=layout(label)
  if condition(nodes):return nodes
  if time.monotonic()>end:raise RuntimeError('UI condition timed out: '+label)
  time.sleep(.5)
def has(nodes,text):return any(n.get('text')==text for n in nodes)
def click(nodes,text):
 n=next(n for n in nodes if n.get('text')==text and n.get('clickable')=='true')
 v=list(map(int,re.findall(r'-?\d+',n['bounds'])))
 call(['shell','uitest','uiInput','click',str((v[0]+v[2])//2),str((v[1]+v[3])//2)])
last_frame=None
def screenshot(label):
 global last_frame
 remote='/data/local/tmp/suike-smoke-'+label+'.jpeg';dest=args.output/(label+'.jpeg')
 end=time.monotonic()+30
 while True:
  call(['shell','snapshot_display','-f',remote]);call(['file','recv',remote,str(dest)])
  with Image.open(dest) as im:
   width,height=im.size;crop=im.crop((0,int(height*.08),width,int(height*.92)))
   variance=max(ImageStat.Stat(crop).var);frame=hashlib.sha256(crop.tobytes()).hexdigest()
  if variance>8 and frame!=last_frame:last_frame=frame;return
  if time.monotonic()>end:raise RuntimeError('Screenshot is blank or has not changed: '+label)
  time.sleep(.5)
checks={}
nodes=ready('today',lambda n:has(n,'今日') and has(n,'周课表') and has(n,'设置'))
checks['mainPageRendered']=not has(nodes,'课表页面尚未加载完成')
screenshot('today')
counters=[n['text'] for n in nodes if n['text'].startswith('本周 ') and '门课程' in n['text']]
click(nodes,'周课表')
nodes=ready('week',lambda n:any(x.get('type')=='grid' or '周课表' in x.get('text','') and x.get('type')=='region' for x in n))
checks['weekPageRendered']=True;screenshot('week')
click(nodes,'设置')
nodes=ready('settings',lambda n:has(n,'DeepSeek 接入'))
checks['settingsRendered']=True;screenshot('settings')
click(nodes,'DeepSeek 接入')
nodes=ready('deepseek',lambda n:has(n,'关闭 DeepSeek') and has(n,'导入文件'))
checks['deepseekRendered']=True
click(nodes,'导入文件')
nodes=ready('picker',lambda n:has(n,'最近') and has(n,'浏览') and has(n,'完成'))
checks['nativeDocumentPickerOpened']=True;screenshot('picker')
call(['shell','uitest','uiInput','keyEvent','2'])
nodes=ready('deepseek-return',lambda n:has(n,'关闭 DeepSeek') and not has(n,'仅可访问所选项目'))
click(nodes,'关闭 DeepSeek')
nodes=ready('settings-return',lambda n:has(n,'DeepSeek 接入'))
click(nodes,'今日')
nodes=ready('today-return',lambda n:has(n,'今日') and has(n,'周课表'))
call(['shell','aa','force-stop','cn.suike.timetable'])
time.sleep(1)
call(['shell','aa','start','-a','EntryAbility','-b','cn.suike.timetable'])
nodes=ready('restart',lambda n:has(n,'今日') and any('门课程' in x.get('text','') for x in n))
after=[n['text'] for n in nodes if n['text'].startswith('本周 ') and '门课程' in n['text']]
checks['courseCountSurvivedProcessRestart']=bool(counters) and counters==after
report={'testedHapSha256':hashlib.sha256(args.hap.read_bytes()).hexdigest(),'emulatorApi':20,'installVerified':True,'mainPageRuntimeVerified':all(checks.values()),'checks':checks,'paidApiCalled':False,'courseDataModified':False,'physicalDevice':False,'cardsRuntimeVerified':False,'visualFramesVerified':True}
(args.output/'RESULT.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,ensure_ascii=False))
if not all(checks.values()):raise SystemExit(1)
