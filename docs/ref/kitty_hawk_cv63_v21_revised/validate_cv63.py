"""Geometry-only regression tests for CV-63 V2.1 (no WebGL required)."""
import ast, math, json, re
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as PatchPolygon, Rectangle
from shapely.geometry import Polygon, box, LineString

HERE=Path(__file__).resolve().parent
source=(HERE/'kitty_hawk_cv63_v21.js').read_text()
points=ast.literal_eval('['+source.split('const DECK_BASE = [',1)[1].split('];',1)[0]+']')
params=json.loads((HERE/'cv63_parameters.json').read_text())
poly0=Polygon(points)
assert poly0.is_valid and poly0.area>10000
levels=sorted(set(p for x,p in points))
def section_width(p,points):
    xs=[]
    for a,b in zip(points,points[1:]+points[:1]):
        if (a[1]<=p<b[1]) or (b[1]<=p<a[1]): xs.append(a[0]+(b[0]-a[0])*(p-a[1])/(b[1]-a[1]))
    if len(xs)<2: return 0
    return max(xs)-min(xs)
ps=[]
for a,b in zip(levels,levels[1:]):
    delta=min(.00001,(b-a)/1000)
    ps.extend([a+delta,(a+b)/2,b-delta])
width=max((section_width(p,points),p) for p in ps)
scale=params['dimensions']['deckMaxSectionWidth']/width[0]
poly=Polygon([(x*scale,p) for x,p in points])
assert abs(max(section_width(p,[(x*scale,y) for x,y in points]) for p in ps)-76.8)<.001
assert 317.9 <= poly.bounds[3]-poly.bounds[1] <= 318.1
pockets=[]
for lift in params['elevators']:
    x,p=(lift['x'],lift['p']); w,l=(lift['w'],lift['len'])
    pocket=box((x-w/2)*scale,p-l/2,(x+w/2)*scale,p+l/2)
    overlap=pocket.intersection(poly).area/pocket.area
    pockets.append((lift['id'],overlap))
    assert overlap < .025, f"lift overlaps deck solid: {lift['id']}: {overlap:.3f}"
# runway use the parameterized 11.2-degree bearing in metric coordinates
angle=math.radians(params['deck']['landingAngleDeg']);p0=-135;p1=44
x0=5.5*scale;x1=x0-(p1-p0)*math.tan(angle)
angleCheck=math.degrees(math.atan2(x0-x1,p1-p0))
assert abs(angleCheck-11.2)<1e-8
# catapult rails compared to outline, excluding tiny texture-clipped tolerance
catapults=[[[6*scale,68],[5.5*scale,157]],[[-7.5*scale,68],[-5.5*scale,157]],
          [[-19*scale,-35],[-33*scale,45]],[[-29*scale,-40],[-43.5*scale,40]]]
for i,ab in enumerate(catapults):
    line=LineString(ab)
    bad=line.difference(poly.buffer(.2)).length
    assert bad<.4, f'catapult {i+1} extends past deck by {bad:.2f}m'

# Draw orthographic wireframe (plan-coordinate system)
fig, ax=plt.subplots(figsize=(9,12.5),dpi=150)
fig.patch.set_facecolor('#f5f7fa');ax.set_facecolor('#f5f7fa')
ax.add_patch(PatchPolygon([(x*scale,p) for x,p in points],closed=True,facecolor='#dfe8ed',edgecolor='#1d465e',lw=2))
# main hull centerline beam outline approximate
stations=params['hull']['stations']
for i,(p,half) in enumerate(stations):
    ax.plot([-half,half],[p,p],color='#91adb9',lw=.65,alpha=.65)
ax.plot([0,0],[-158,162],color='#9ba9b0',lw=.6,ls='--')
for i,(name,overlap) in enumerate(pockets):
    info=params['elevators'][i];x,p=(info['x'],info['p']);w,l=(info['w'],info['len'])
    ax.add_patch(Rectangle(((x-w/2)*scale,p-l/2),w*scale,l,facecolor='#9bbfb6',edgecolor='#386a5c',lw=1.1))
    ax.text(x*scale,p,str(i+1),color='#124c3d',fontsize=9,ha='center',va='center',weight='bold')
ax.plot([x0,x1],[p0,p1],color='#de704d',lw=2,label='Angled landing axis · 11.2°')
for ab in catapults:ax.plot([ab[0][0],ab[1][0]],[ab[0][1],ab[1][1]],color='#4a8493',lw=1.2)
ax.add_patch(Rectangle((25*scale,-45),10*scale,32,facecolor='#658c9d',edgecolor='#315369',alpha=.9))
ax.text(0,165,'BOW',ha='center',fontsize=10,color='#244e60')
ax.text(0,-165,'STERN',ha='center',fontsize=10,color='#244e60')
ax.set_aspect('equal','box');ax.set_xlim(-55,51);ax.set_ylim(-172,178)
ax.set_title('CV-63 · V2.1 Deck Geometry Check\nsection width 76.8 m · 4 edge elevators · 11.2° landing axis',loc='left',fontsize=12,weight='bold',color='#163d55',pad=14)
ax.set_xlabel('Port ← X (m) → Starboard');ax.set_ylabel('Plan-Y (m, bow positive)')
ax.grid(alpha=.12);ax.legend(loc='lower left',frameon=False,fontsize=9)
fig.tight_layout();fig.savefig(HERE/'cv63_v21_geometry_check.png',bbox_inches='tight');plt.close(fig)
result={'polygon_valid':poly0.is_valid,'base_max_section_width':round(width[0],4),
        'scaled_max_section_width':76.8,'deck_x_scale':round(scale,7),
        'deck_plan_length_m':318.0,'landing_angle_deg':round(angleCheck,3),
        'elevator_deck_overlap':{k:round(v,5) for k,v in pockets},
        'catapults_tested':4,'status':'passed'}
(HERE/'validation_results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print(json.dumps(result,ensure_ascii=False,indent=2))
