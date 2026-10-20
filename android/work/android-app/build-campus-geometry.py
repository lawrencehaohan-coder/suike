from pathlib import Path
import json,math
R=Path(__file__).resolve().parent
scene=json.loads((R/'vendor/just-zjg-campus/scene-calibrated.json').read_text(encoding='utf-8'));step=2
def inside(x,y,pts):
 hit=False;j=len(pts)-1
 for i,(xi,yi) in enumerate(pts):
  xj,yj=pts[j]
  if ((yi>y)!=(yj>y)) and x<(xj-xi)*(y-yi)/(yj-yi)+xi:hit=not hit
  j=i
 return hit
meshes=[]
for b in scene['buildings']+scene['contextBuildings']:
 pts=b.get('pts')
 if not pts:
  x,y=b['center'];w=b.get('w',20);h=b.get('h',20);pts=[[x-w/2,y-h/2],[x+w/2,y-h/2],[x+w/2,y+h/2],[x-w/2,y+h/2]]
 lo=[math.floor(min(p[k] for p in pts)/step) for k in [0,1]];hi=[math.ceil(max(p[k] for p in pts)/step) for k in [0,1]]
 cells={(x,y) for y in range(lo[1],hi[1]) for x in range(lo[0],hi[0]) if inside((x+.5)*step,(y+.5)*step,pts)}
 assert cells,b['id']
 roofs=[];active={}
 for y in range(lo[1],hi[1]+1):
  xs=sorted(x for x,yy in cells if yy==y);runs=[]
  for x in xs:
   if runs and runs[-1][1]==x:runs[-1][1]=x+1
   else:runs.append([x,x+1])
  current={}
  for x0,x1 in runs:
   key=(x0,x1)
   if key in active:rect=active[key];rect[3]=y+1
   else:rect=[x0,y,x1,y+1]
   current[key]=rect
  roofs.extend(v for k,v in active.items() if k not in current);active=current
 edges={}
 for x,y in cells:
  for axis,direction,near,a,c in [(0,-1,(x-1,y),x,y),(0,1,(x+1,y),x+1,y),(1,-1,(x,y-1),y,x),(1,1,(x,y+1),y+1,x)]:
   if near not in cells:edges.setdefault((axis,direction,a),[]).append(c)
 walls=[]
 for (axis,direction,a),values in edges.items():
  runs=[]
  for v in sorted(values):
   if runs and runs[-1][1]==v:runs[-1][1]=v+1
   else:runs.append([v,v+1])
  for v0,v1 in runs:walls.append([axis,direction,a*step,v0*step,v1*step])
 cx=sum((x+.5)*step for x,y in cells)/len(cells);cy=sum((y+.5)*step for x,y in cells)/len(cells);anchor=min(cells,key=lambda p:((p[0]+.5)*step-cx)**2+((p[1]+.5)*step-cy)**2)
 shape=b.get('shape',{});centre=shape['center'] if shape.get('type')=='ellipse' else [round(cx,2),round(cy,2)]
 meshes.append({'id':b['id'],'name':b.get('name','建筑'),'aliases':b.get('aliases',[]),'type':b.get('type','building'),'shape':shape,'height':b.get('height',12),'estimatedFloors':b.get('estimatedFloors',1),'heightConfidence':b.get('heightEstimate',{}).get('confidence','low'),'details':b.get('modelDetails',{}),'footprint':pts,'center':centre,'anchor':centre if shape.get('type')=='ellipse' else [(anchor[0]+.5)*step,(anchor[1]+.5)*step],'bounds':[lo[0]*step,lo[1]*step,hi[0]*step,hi[1]*step],'roofs':[[v*step for v in r] for r in roofs],'walls':walls,'context':b in scene['contextBuildings']})
data={'version':2,'step':step,'presentation':scene.get('presentation',{}),'site':scene['site'],'frame':scene['frame'],'overview':scene['overview'],'buildings':meshes,'zones':scene.get('zones',[]),'roads':scene['roads'],'paths':scene['paths']+scene['manualPaths'],'waters':scene['waters'],'features':scene['features'],'tracks':scene['tracks']}
(R/'campus-data.js').write_text('/* User-supplied JUST Zhangjiagang geometry. OSM contributors, ODbL; see vendor/just-zjg-campus/README.md. */\nwindow.SuikeCampusScene='+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8',newline='\n')
print('White pixel scene:',len(meshes),'buildings;',sum(len(b['roofs']) for b in meshes),'merged roofs;',sum(len(b['walls']) for b in meshes),'wall strips;',len(data['roads']),'roads.')
