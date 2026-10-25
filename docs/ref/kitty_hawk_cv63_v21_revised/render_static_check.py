"""Static geometry-only visualization from same parameter values, not WebGL screenshot."""
import ast, json, math
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection, Line3DCollection
from scipy.interpolate import CubicSpline
P=Path(__file__).resolve().parent
config=json.loads((P/'cv63_parameters.json').read_text())
src=(P/'kitty_hawk_cv63_v21.js').read_text()
cont=ast.literal_eval('['+src.split('const DECK_BASE = [',1)[1].split('];',1)[0]+']')
from shapely.geometry import Polygon
ys=sorted(set(p for x,p in cont))
def cross(p):
 xs=[]
 for a,b in zip(cont,cont[1:]+cont[:1]):
  if a[1]<=p<b[1] or b[1]<=p<a[1]: xs.append(a[0]+(b[0]-a[0])*(p-a[1])/(b[1]-a[1]))
 return max(xs)-min(xs) if len(xs)>1 else 0
samples=[]
for a,b in zip(ys,ys[1:]):
 eps=min(1e-5,(b-a)/1000)
 samples.extend([a+eps,(a+b)/2,b-eps])
s=76.8/max(map(cross,samples))
stations=np.array(config['hull']['stations'])
interp=CubicSpline(stations[:,0],stations[:,1],bc_type='natural')
ps=np.linspace(-157,161,78)
profile=[(-.83,9.2),(-.95,6.8),(-1,2.4),(-.99,.55),(-.94,-1.2),(-.82,-4.8),(-.59,-8.1),(-.27,-10.2),(0,-10.9),(.27,-10.2),(.59,-8.1),(.82,-4.8),(.94,-1.2),(.99,.55),(1,2.4),(.95,6.8),(.83,9.2)]
fig=plt.figure(figsize=(15,8.2),dpi=165)
ax=fig.add_subplot(projection='3d')
fig.patch.set_facecolor('#f6f8fa');ax.set_facecolor('#f6f8fa')
polys=[];colors=[]
for i in range(len(ps)-1):
 for j in range(len(profile)-1):
  if -114<ps[i]<-92 and j<=1:continue
  q=[]
  for k,t in [(i,j),(i+1,j),(i+1,j+1),(i,j+1)]:
   frac,y=profile[t];p=ps[k];q.append((frac*interp(p),-p,y))
  polys.append(q)
  if j in [3,12]:col='#25343d'
  elif 4<=j<=11:col='#8e5c5c'
  else:col='#9aabb5'
  colors.append(col)
ax.add_collection3d(Poly3DCollection(polys,facecolors=colors,linewidths=.02,edgecolor='#5e707b',alpha=.97))
# deck top as triangular fan for schematic only
poly=[(x*s,-p,12.2) for x,p in cont]
center=(sum(x for x,y,z in poly)/len(poly),sum(y for x,y,z in poly)/len(poly),12.2)
# Instead of fan through concave perimeter (invalid in 3D), triangulate via shapely
from shapely.ops import triangulate
shape=Polygon([(x*s,-p) for x,p in cont])
tris=[[(x,y,12.2) for x,y in list(t.exterior.coords)[:3]] for t in triangulate(shape) if shape.covers(t.representative_point())]
ax.add_collection3d(Poly3DCollection(tris,facecolor='#475962',edgecolor='#a9b9c1',linewidth=.18,alpha=.96))
# elevators
for e in config['elevators']:
 x,p=(e['x'],e['p']);w,l=(e['w'],e['len']);xs=[(x-w/2)*s,(x+w/2)*s]; zs=[-p-l/2,-p+l/2]
 ax.add_collection3d(Poly3DCollection([[(xs[0],zs[0],12.24),(xs[1],zs[0],12.24),(xs[1],zs[1],12.24),(xs[0],zs[1],12.24)]],facecolor='#94bbae',edgecolor='#193f4b',linewidth=1.3))
# island block supports
for x,y,z,w,d,h in [(29.5*s,12.2,26,9,33,7),(29*s,19.2,22,10,20,6),(29*s,25.2,21,7,13,3)]:
 x0=x-w/2;x1=x+w/2;z0=z-d/2;z1=z+d/2;y0=y;y1=y+h
 panels=[[(x0,z0,y0),(x1,z0,y0),(x1,z0,y1),(x0,z0,y1)],[(x1,z0,y0),(x1,z1,y0),(x1,z1,y1),(x1,z0,y1)],[(x0,z0,y1),(x1,z0,y1),(x1,z1,y1),(x0,z1,y1)]]
 ax.add_collection3d(Poly3DCollection(panels,facecolor='#778b99',edgecolor='#2a5064',linewidth=.6))
ax.plot([29*s,29*s],[22,22],[28,55],color='#294a5d',lw=2)
# deck markings
x0=5.5*s;p0=-135;p1=44;x1=x0-(p1-p0)*math.tan(math.radians(11.2))
ax.plot([x0,x1],[-p0,-p1],[12.34,12.34],color='#f0ba89',lw=2)
for p,a,b in [(68,6*s,5.5*s),(68,-7.5*s,-5.5*s)]:ax.plot([a,b],[-p,-157],[12.35,12.35],color='#dadfe3',lw=1.5)
ax.set_xlim(-70,70);ax.set_ylim(-172,172);ax.set_zlim(-22,68)
ax.set_box_aspect((150,335,93),zoom=1.35)
ax.view_init(elev=27,azim=-42)
ax.set_axis_off()
fig.text(.065,.91,'CV-63  /  V2.1',color='#183b4e',size=22,weight='bold')
fig.text(.065,.875,'3D hull loft + angled deck + four elevator clearances',color='#647f8d',size=12)
fig.text(.065,.105,'Geometry verification render (not a browser/WebGL screenshot)  ·  Scale 1 unit = 1 m',size=9,color='#738998')
fig.savefig(P/'cv63_v21_isometric_check.png',bbox_inches='tight',facecolor=fig.get_facecolor())
print('created',P/'cv63_v21_isometric_check.png')
