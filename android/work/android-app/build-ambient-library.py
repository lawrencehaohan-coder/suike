"""Offline format packaging of the user's original scenes; never invent artwork.
All original scenes qualify regardless of file size. green-storm is
explicitly excluded. Small animated WebP resources are loaded one at a time.
"""
from pathlib import Path
from PIL import Image,ImageDraw
import json,hashlib
R=Path(__file__).resolve().parent
POOLS={'morning':['alpine-dawn','misty-forest','taj-dawn','jal-mahal','earthrise','salt-flat'],'noon':['jungle-falls','deep-reef','kite-festival','saturn-rise','black-prism'],'afternoon':['ocean-sunset','cloud-sea','lake-pichola','kyoto-dusk','night-highway','storm-plains'],'night':['lantern-lake','aurora-fjord','desert-night','amer-fort','command-city','edge-orbit','gangaur-ghat','lava-wall','marine-drive','night-coast','planet-scale','prism-city','snow-train','tokyo-rain','varanasi-ghats','volcano-night']}
catalog=json.loads((R/'vendor/ascii-rest/catalog.json').read_text(encoding='utf-8'));records={p['slug']:p for p in catalog['pieces']};out=R/'assets/ambient-scenes';out.mkdir(exist_ok=True)
pieces={};sources=[];contact=Image.new('RGB',(1200,2400),'#f4f4f1');pen=ImageDraw.Draw(contact)
selected={p['slug'] for p in catalog['pieces'] if p['category']=='scenes' and p['slug']!='green-storm'}
assert set(sum(POOLS.values(),[]))==selected and len(selected)==33
for i,slug in enumerate(sum(POOLS.values(),[])):
 original=R/'vendor/ascii-rest/originals';gif=original/(slug+'.gif');svg=original/(slug+'.svg');record=records[slug]
 assert record['category']=='scenes' and slug!='green-storm'
 assert gif.stat().st_size==record['gif']['bytes'] and svg.stat().st_size==record['svg']['bytes']
 source={'slug':slug,'category':'scenes','originalGifBytes':gif.stat().st_size,'originalSvgBytes':svg.stat().st_size,'gifSHA256':hashlib.sha256(gif.read_bytes()).hexdigest(),'svgSHA256':hashlib.sha256(svg.read_bytes()).hexdigest(),'qualifiedFile':slug+'.svg','logicalCols':record['cols'],'logicalRows':record['rows']}
 cached=False
 try:
  with Image.open(out/(slug+'.webp')) as encoded:cached=encoded.is_animated and encoded.size==(400,200)
  cached=cached and (out/(slug+'.png')).is_file()
 except (OSError,EOFError):pass
 with Image.open(gif) as animation:
  count=animation.n_frames;frames=[];durations=[]
  for index in range(1 if cached else count):
   animation.seek(index);frames.append(animation.convert('RGB').resize((400,200),Image.Resampling.LANCZOS));durations.append(animation.info.get('duration',67))
  if not cached:
   temporary=out/(slug+'.part.webp')
   frames[0].save(temporary,format='WEBP',save_all=True,append_images=frames[1:],duration=durations,loop=0,quality=88,method=1,minimize_size=False,allow_mixed=False,kmin=9,kmax=17)
   temporary.replace(out/(slug+'.webp'))
  frames[0].save(out/(slug+'.png'),format='PNG',optimize=True)
  with Image.open(out/(slug+'.webp')) as encoded:assert encoded.is_animated and encoded.n_frames>1
  pieces[slug]={'cols':record['cols'],'rows':record['rows'],'frameWidth':400,'frameHeight':200,'count':count,'fps':record['gif']['fps'],'animation':slug+'.webp','poster':slug+'.png','source':source}
  contact.paste(frames[0].resize((380,190)),(i%3*400+10,i//3*215+22));pen.text((i%3*400+12,i//3*215+5),slug,fill='#222222')
 sources.append(source);print(slug,(out/(slug+'.webp')).stat().st_size,'bytes',flush=True)
(R/'ambient-frames.json').write_text(json.dumps({'version':3,'author':'bas3line','license':'MIT','origin':'ascii.rest 0.4.0','pools':POOLS,'pieces':pieces},separators=(',',':')),encoding='utf-8')
(R/'vendor/ascii-rest/SELECTED_ASSETS.json').write_text(json.dumps({'rule':'All scenes, no file-size threshold','excluded':['green-storm'],'pools':POOLS,'assets':sources},indent=2),encoding='utf-8')
docs=R.parents[1]/'docs';docs.mkdir(exist_ok=True);contact.save(docs/'pixel-scene-contact-sheet.png')
print('All 33 scenes packaged as separate lazy-loaded resources.')
