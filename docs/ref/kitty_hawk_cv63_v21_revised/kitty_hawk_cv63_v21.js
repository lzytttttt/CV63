/**
 * USS KITTY HAWK (CV-63) — parametric structure study V2.1
 * Based on the user's js.txt. Approximate educational geometry, NOT technical ship plans.
 * 1 unit = 1 m. -X port, +X starboard; +Y up; -Z bow, +Z stern.
 * Plan 2D (x, p): p positive toward bow => world z=-p.
 * Compatible: createCV63KittyHawk() returns THREE.Group.
 * Extended: createCV63KittyHawkModel() returns {group, parts, controllers, metrics}.
 */
import * as THREE from 'three';

export const CV63_PARAMS = {
  dimensions: { hullLength: 318, hullBeam: 39.5, draft: 10.9, deckMaxSectionWidth: 76.8 },
  deck: { topY: 12.2, thickness: 1.2, landingAngleDeg: 11.2, stripHalfWidth: 11.5, textureSeed: 63 },
  hull: { longitudinalSegments: 96,
    // [plan y (bow positive), half-beam]. These are deliberate silhouette control stations.
    stations: [[-157,11.6],[-148,14.4],[-128,17.9],[-100,19.15],[-60,19.75],[0,19.75],[45,19.7],[85,18.4],[115,15.2],[141,8.3],[156,2.4],[161,0.4]] },
  elevators: [
    { id:'Elevator_1_Stbd_Fwd', side:'stbd', x:30.5, p:63, w:11.3, len:19.6, maxDrop:8 },
    { id:'Elevator_2_Stbd_Mid', side:'stbd', x:32.0, p:14, w:11.8, len:19.6, maxDrop:8 },
    { id:'Elevator_3_Stbd_Aft', side:'stbd', x:29.0, p:-71, w:10.2, len:19.6, maxDrop:8 },
    { id:'Elevator_4_Port_Aft', side:'port', x:-20.0, p:-103, w:9.5, len:19.6, maxDrop:8 },
  ],
  island: { x:29.5, p:-26 },
  materials: { hull:0x899aa6, deck:0x303740, support:0x667985, red:0x7c373b, black:0x262d34, window:0x1e3e52 },
};

// The original 2D contours are preserved as control points, then projected with ONE width transform.
// Unlike a bounding-box-based scale, maximum width is evaluated at matching longitudinal positions.
const DECK_BASE = [
  [-8.5,161],[8.5,161],[15.5,128],[24,92],[31,76],
  [24.5,74],[24.5,52],[35,50],[37.5,26],
  [26,25],[26,3],[38.5,1],[39,-54],[34.5,-58],
  [24,-60],[24,-82],[33.5,-84],[31,-112],[22,-138],[15.5,-157],
  [-14.5,-157],[-20,-132],[-22.5,-116],
  [-15,-114],[-15,-92],[-24,-90],[-27.5,-72],
  [-41,-5],[-46.5,25],[-47,44],[-34,49],[-28.5,60],
  [-22,66],[-19.5,96],[-14.5,130]
];

export function planCrossSection(points, p) {
  const hits=[];
  for (let i=0;i<points.length;i++) {
    const a=points[i], b=points[(i+1)%points.length];
    if ((a[1]<=p && p<b[1]) || (b[1]<=p && p<a[1]))
      hits.push(a[0]+(b[0]-a[0])*(p-a[1])/(b[1]-a[1]));
  }
  hits.sort((a,b)=>a-b);
  return hits.length>=2 ? {left:hits[0], right:hits[hits.length-1], width:hits[hits.length-1]-hits[0]} : null;
}
export function maxDeckSectionWidth(points=DECK_BASE) {
  const ps=[...new Set(points.map(p=>p[1]))].sort((a,b)=>a-b);
  let best={width:0,p:0};
  for(let i=0;i<ps.length-1;i++) {
    // For a polygon, section width is piecewise linear and an extremum can be
    // exactly beside a polygon vertex; midpoint-only sampling underestimates it.
    const delta=Math.min(0.00001,(ps[i+1]-ps[i])/1000);
    for(const p of [ps[i]+delta,(ps[i]+ps[i+1])/2,ps[i+1]-delta]) {
      const row=planCrossSection(points,p);
      if(row && row.width>best.width) best={width:row.width,p};
    }
  }
  return best;
}
function resolveConfig(user={}) {
  const c={...CV63_PARAMS,
    dimensions:{...CV63_PARAMS.dimensions,...user.dimensions},
    deck:{...CV63_PARAMS.deck,...user.deck},
    hull:{...CV63_PARAMS.hull,...user.hull},
    island:{...CV63_PARAMS.island,...user.island},
    materials:{...CV63_PARAMS.materials,...user.materials},
    elevators:user.elevators ?? CV63_PARAMS.elevators};
  if(c.dimensions.deckMaxSectionWidth<=0) throw new Error('deckMaxSectionWidth must be positive');
  if(c.deck.thickness<=0) throw new Error('deck thickness must be positive');
  if(!Array.isArray(c.hull.stations)||c.hull.stations.length<3) throw new Error('At least 3 hull stations required');
  for(let i=1;i<c.hull.stations.length;i++) if(c.hull.stations[i][0] <= c.hull.stations[i-1][0]) throw new Error('Hull stations must be sorted by ascending plan Y');
  return c;
}
function makeSceneMaterials(c) {
  return {
    hull:new THREE.MeshStandardMaterial({color:c.materials.hull,metalness:0.12,roughness:0.77,side:THREE.DoubleSide}),
    black:new THREE.MeshStandardMaterial({color:c.materials.black,roughness:0.85,side:THREE.DoubleSide}),
    red:new THREE.MeshStandardMaterial({color:c.materials.red,roughness:0.8,side:THREE.DoubleSide}),
    support:new THREE.MeshStandardMaterial({color:c.materials.support,metalness:0.16,roughness:0.8}),
    deck:new THREE.MeshStandardMaterial({color:c.materials.deck,roughness:0.92}),
    edge:new THREE.MeshStandardMaterial({color:0xa4b4bb,metalness:0.17,roughness:0.75}),
    glass:new THREE.MeshStandardMaterial({color:c.materials.window,metalness:0.28,roughness:0.28}),
    radar:new THREE.MeshStandardMaterial({color:0xc7d6d8,roughness:0.65}),
    elevator:new THREE.MeshStandardMaterial({color:0x454d53,roughness:0.83}),
  };
}

// Station-interpolated, genuine 3D cross-section hull; not a vertically extruded 2D outline.
// Open shell cross-section runs port upper chine -> keel -> starboard upper chine.
// Deliberately no solid roof above hangar: the flight deck is a separate assembly.
export function createLoftHullGeometry(c) {
  const stations=c.hull.stations;
  const lengthScale=c.dimensions.hullLength/318, beamScale=c.dimensions.hullBeam/39.5;
  const seq=[
    [-0.83,9.2],[-0.95,6.8],[-1,2.4],[-0.99,0.55],[-0.94,-1.2],
    [-0.82,-4.8],[-0.59,-8.1],[-0.27,-10.2],[0,-10.9],
    [0.27,-10.2],[0.59,-8.1],[0.82,-4.8],[0.94,-1.2],
    [0.99,0.55],[1,2.4],[0.95,6.8],[0.83,9.2]
  ];
  // Width profile is interpolated smoothly through verified station half beams.
  const spline=new THREE.SplineCurve(stations.map(([p,w])=>new THREE.Vector2(p*lengthScale,w*beamScale)));
  const n=Math.max(12,Math.round(c.hull.longitudinalSegments));
  const m=seq.length;
  const vertices=[]; const normals=[]; const indices=[];
  // Curve uses original station spacing to keep tight bow transition, including actual endpoints.
  const sampled=[];
  for(let i=0;i<=n;i++) sampled.push(spline.getPoint(i/n));
  for (const point of sampled) {
    for (const [frac,baseY] of seq) {
      vertices.push(frac * point.y, baseY*c.dimensions.draft/10.9, -point.x);
    }
  }
  // Build per-profile-band groups to preserve waterline and antifouling band.
  const materialForBand=(k)=>{
    if(k===3 || k===12) return 1; // waterline boot topping
    if((k>=4&&k<=11)) return 2;  // underwater red
    return 0;
  };
  const groups=[];
  for(let j=0;j<m-1;j++) {
    const start=indices.length;
    for(let i=0;i<n;i++) {
      const pMid=(sampled[i].x+sampled[i+1].x)/2;
      // Opening in the port topside, behind the port elevator. This makes it
      // possible to lower the lift into its shaft without hitting a solid shell.
      const portLift=c.elevators.find(e=>e.side==='port');
      const isPortShaft=portLift && Math.abs(pMid-portLift.p*lengthScale)<(portLift.len*lengthScale/2+1);
      if(isPortShaft && j<=1) continue;
      const a=i*m+j, b=(i+1)*m+j, d=i*m+j+1, cc=(i+1)*m+j+1;
      indices.push(a,b,d, b,cc,d);
    }
    if(indices.length>start) groups.push([start,indices.length-start,materialForBand(j)]);
  }
  // Explicit bow/stern caps. The long upper edge remains open for the hangar.
  for(const idx of [0,n]) {
    const start=indices.length;
    const core=vertices.length/3;
    vertices.push(0,-0.5,-sampled[idx].x);
    for(let k=0;k<m-1;k++) {
      const a=idx*m+k, b=idx*m+k+1;
      if(idx===0) indices.push(core,b,a); else indices.push(core,a,b);
    }
    groups.push([start,indices.length-start,0]);
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  geo.setIndex(indices);
  groups.forEach(([start,count,material])=>geo.addGroup(start,count,material));
  geo.computeVertexNormals();
  return geo;
}
function deckPolygon(scale,lengthScale=1) { return DECK_BASE.map(([x,p])=>[x*scale,p*lengthScale]); }
function polygonShape(points) {
  const shape=new THREE.Shape(); points.forEach(([x,p],i)=>i?shape.lineTo(x,p):shape.moveTo(x,p)); shape.closePath(); return shape;
}
function planToWorld(x,p,y){return new THREE.Vector3(x,y,-p);}
function orientHorizontal(geo,baseY){geo.rotateX(-Math.PI/2);geo.translate(0,baseY,0);geo.computeVertexNormals();return geo;}
function setDeckCapUV(geo,bounds){
  const pos=geo.getAttribute('position'),uv=geo.getAttribute('uv');
  for(let i=0;i<pos.count;i++) uv.setXY(i,(pos.getX(i)-bounds.minX)/(bounds.maxX-bounds.minX),(pos.getY(i)-bounds.minP)/(bounds.maxP-bounds.minP));
  uv.needsUpdate=true;
}
function rng(seed){let x=seed>>>0;return()=>{x=(Math.imul(1664525,x)+1013904223)>>>0;return x/4294967296;};}
function createDeckTexture(c,scale,bounds) {
  if(typeof document==='undefined') return null; // geometry is still usable by Node tooling
  const L=c.dimensions.hullLength/318;
  const canvas=document.createElement('canvas'); canvas.width=1024; canvas.height=Math.round(3531*L);
  const ctx=canvas.getContext('2d'); if(!ctx) return null;
  const xPx=x=>(x-bounds.minX)/(bounds.maxX-bounds.minX)*canvas.width;
  const pPx=p=>(1-(p-bounds.minP)/(bounds.maxP-bounds.minP))*canvas.height;
  const pxPerM=canvas.width/(bounds.maxX-bounds.minX);
  const random=rng(c.deck.textureSeed);
  ctx.fillStyle='#323940';ctx.fillRect(0,0,canvas.width,canvas.height);
  for(let i=0;i<26000;i++){
    ctx.fillStyle=random()>.5?'rgba(225,232,235,0.027)':'rgba(0,0,0,0.042)';
    ctx.fillRect(random()*canvas.width,random()*canvas.height,2,6);
  }
  function line(points,color,width,dash=[]){ctx.save();ctx.strokeStyle=color;ctx.lineWidth=width*pxPerM;ctx.setLineDash(dash.map(v=>v*pxPerM));ctx.beginPath();points.forEach(([x,p],i)=>i?ctx.lineTo(xPx(x),pPx(p)):ctx.moveTo(xPx(x),pPx(p)));ctx.stroke();ctx.restore();}
  // Landing centerline and BOTH runway boundaries are derived from the same 11.2° parameter.
  const tail={x:5.5*scale,p:-135*L}; const foreP=44*L;
  const bow={x:tail.x-(foreP-tail.p)*Math.tan(c.deck.landingAngleDeg*Math.PI/180),p:foreP};
  const deltaX=bow.x-tail.x, deltaP=bow.p-tail.p;
  const len=Math.hypot(deltaX,deltaP);
  const normal=[deltaP/len,-deltaX/len]; // perpendicular in (x,p)
  const offset=(q,d)=>[q.x+normal[0]*d,q.p+normal[1]*d];
  const w=c.deck.stripHalfWidth;
  line([offset(tail,-w),offset(bow,-w)],'#dadee0',0.55);
  line([offset(tail,w),offset(bow,w)],'#dadee0',0.55);
  line([[tail.x,tail.p],[bow.x,bow.p]],'#b8c0c5',0.35,[5,6]);
  // Four representative arrestor wires at equal spans on the angled landing strip.
  for(let f of [.16,.21,.26,.31]){
    const q={x:tail.x+deltaX*f,p:tail.p+deltaP*f};
    line([offset(q,-w+.6),offset(q,w-.6)],'#b3bbc0',0.4);
  }
  // Catapults: all rails are inside or clipped to the flight deck footprint.
  const catapults=[[[6*scale,68*L],[5.5*scale,157*L]],[[-7.5*scale,68*L],[-5.5*scale,157*L]],
      [[-19*scale,-35*L],[-33*scale,45*L]],[[-29*scale,-40*L],[-43.5*scale,40*L]]];
  catapults.forEach(pair=>{line(pair,'#aeb8be',1.0);line(pair,'#11191e',.38);});
  // Bow number and dotted staging lines (deck will clip extraneous pixels).
  ctx.save();ctx.fillStyle='#e0e6e9';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.font=`bold ${Math.round(13*pxPerM)}px Arial,sans-serif`;ctx.fillText('63',xPx(0),pPx(142*L));ctx.restore();
  line([[22*scale,-143*L],[22*scale,44*L]],'#b45b56',.55);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  texture.anisotropy=8;texture.needsUpdate=true;return texture;
}
function stick(a,b,r,material){
  const d=b.clone().sub(a);const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,d.length(),6),material);
  mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());return mesh;
}
function addBox(group,name,size,pos,mat){const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),mat);mesh.position.set(...pos);mesh.name=name;group.add(mesh);return mesh;}
function createIsland(c,scale,mats) {
  const island=new THREE.Group();island.name='Island';
  island.position.copy(planToWorld(c.island.x*scale,c.island.p*c.dimensions.hullLength/318,c.deck.topY));
  const steel=mats.hull,glass=mats.glass;
  addBox(island,'Navigation_Base',[9.2,7.0,33],[0,3.5,0],steel);
  addBox(island,'Bridge_Shelf',[10.8,1.15,22],[-.5,7.1,-4.1],mats.support);
  addBox(island,'Bridge_Tier',[10.5,3.2,19],[-.4,9.3,-4.1],steel);
  addBox(island,'Bridge_Window_Band',[10.8,1.5,18.9],[-.4,9.8,-4.1],glass);
  addBox(island,'AirOps_PriFly_Overhang',[12.3,2.4,11],[-1.15,12.1,-8.1],steel);
  addBox(island,'PriFly_Glazing',[12.5,.95,10.7],[-1.15,12.55,-8.1],glass);
  const funnel=addBox(island,'Sloped_Exhaust_Funnel',[6.7,11.3,10.1],[1,13.0,9.4],steel);
  funnel.rotation.x=-.16;
  addBox(island,'Exhaust_Cowl',[6.3,1.4,8.1],[1.0,19.4,10],mats.black);
  const mastBase=new THREE.Vector3(.2,13.3,-2.3);
  const mastTip=new THREE.Vector3(.2,31.0,-3.7);
  island.add(stick(mastBase,mastTip,.43,mats.support));
  for(let h=17;h<30;h+=3.7){
    const at=new THREE.Vector3(.2,h,-3.4);
    island.add(stick(new THREE.Vector3(-3.1,h-2,-3.4),at,.19,mats.edge));
    island.add(stick(at,new THREE.Vector3(3.1,h-2,-3.4),.19,mats.edge));
    island.add(stick(new THREE.Vector3(-3.1,h-2,-3.4),new THREE.Vector3(3.1,h-2,-3.4),.15,mats.edge));
  }
  const radar=addBox(island,'Planar_Radar',[5.3,4.9,.5],[.15,27.5,-3.7],mats.radar);radar.rotation.y=.23;
  island.add(stick(new THREE.Vector3(0,14.8,14.0),new THREE.Vector3(0,26.2,13.4),.28,mats.support));
  const radome=new THREE.Mesh(new THREE.SphereGeometry(1.7,14,10),mats.radar);radome.position.set(-2.9,16.3,-11);radome.name='Radome';island.add(radome);
  return island;
}
function makeElevators(c,scale,mats){
  const group=new THREE.Group();group.name='Elevators';const meshes=new Map();
  for(const info of c.elevators){
    const w=info.w*scale,len=info.len*c.dimensions.hullLength/318;
    const lift=new THREE.Group();lift.name=info.id;
    const platform=addBox(lift,'Platform',[w,c.deck.thickness,len],[0,0,0],mats.elevator);
    platform.material.side=THREE.DoubleSide;
    lift.position.set(info.x*scale,c.deck.topY-c.deck.thickness/2,-info.p*c.dimensions.hullLength/318);
    const trim=new THREE.LineSegments(new THREE.EdgesGeometry(platform.geometry),new THREE.LineBasicMaterial({color:0xc7d4d8}));platform.add(trim);
    group.add(lift);meshes.set(info.id,{group:lift,info,restY:lift.position.y});
  }
  return {group,meshes};
}
function makeUnderDeckSupports(points,c,scale,mats){
  const group=new THREE.Group();group.name='Outboard_Supports';
  // Perimeter lip follows the real deck polygon; structural ribs only where the perimeter extends beyond the hull.
  const perimeter=points.map(([x,p])=>planToWorld(x,p,c.deck.topY-c.deck.thickness+.05));
  const line=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(perimeter),new THREE.LineBasicMaterial({color:0x93a7b2,transparent:true,opacity:.8}));
  group.add(line);
  const L=c.dimensions.hullLength/318, beamScale=c.dimensions.hullBeam/39.5;
  const pockets=[...c.elevators.map(e=>({p:e.p*L,len:e.len*L,side:e.side}))];
  for(let i=0;i<points.length;i++) {
    const a=points[i], b=points[(i+1)%points.length];
    const dx=b[0]-a[0], dp=b[1]-a[1],len=Math.hypot(dx,dp);
    for(let s=0;s<Math.floor(len/13);s++){
      const t=(s+1)/(Math.floor(len/13)+1),x=a[0]+dx*t,p=a[1]+dp*t;
      const sourceHalfBeam=interpolateHalfBeam(c.hull.stations,p/L)*beamScale*.83;
      if(Math.abs(x)<sourceHalfBeam+4) continue;
      if(pockets.some(v=>Math.abs(v.p-p)<v.len/2+2 && (v.side==='stbd'? x>0:x<0)))continue;
      group.add(stick(planToWorld(Math.sign(x)*sourceHalfBeam,p,7.7),planToWorld(x,p,c.deck.topY-c.deck.thickness+.05),.24,mats.support));
    }
  }
  return group;
}
function interpolateHalfBeam(stations,p) {
  if(p<=stations[0][0])return stations[0][1];
  if(p>=stations[stations.length-1][0])return stations[stations.length-1][1];
  for(let i=1;i<stations.length;i++)if(p<=stations[i][0]){
    const [p0,w0]=stations[i-1], [p1,w1]=stations[i];const t=(p-p0)/(p1-p0);
    return w0+(w1-w0)*t;
  }
  return stations[stations.length-1][1];
}
export function createCV63KittyHawkModel(userConfig={}) {
  const c=resolveConfig(userConfig);
  const sourceWidth=maxDeckSectionWidth(DECK_BASE);
  const scale=c.dimensions.deckMaxSectionWidth/sourceWidth.width;
  const L=c.dimensions.hullLength/318;
  const polygon=deckPolygon(scale,L);
  const bounds={minX:-50,maxX:46,minP:-165*L,maxP:165*L};
  const mats=makeSceneMaterials(c);
  const group=new THREE.Group(); group.name='USS_Kitty_Hawk_CV63_V21';
  const parts={};
  parts.hull=new THREE.Group();parts.hull.name='Hull';
  const hullMesh=new THREE.Mesh(createLoftHullGeometry(c),[mats.hull,mats.black,mats.red]);
  hullMesh.name='Lofted_Hull_Mesh';parts.hull.add(hullMesh);
  parts.deck=new THREE.Group();parts.deck.name='FlightDeck';
  const deckGeo=new THREE.ExtrudeGeometry(polygonShape(polygon),{depth:c.deck.thickness,bevelEnabled:false,curveSegments:2,steps:1});
  setDeckCapUV(deckGeo,bounds);orientHorizontal(deckGeo,c.deck.topY-c.deck.thickness);
  const texture=createDeckTexture(c,scale,bounds);
  const deckMat=mats.deck.clone();if(texture)deckMat.map=texture;
  const deckMesh=new THREE.Mesh(deckGeo,[deckMat,mats.support]);deckMesh.name='FlightDeck_Mesh';parts.deck.add(deckMesh);
  parts.supports=makeUnderDeckSupports(polygon,c,scale,mats);
  parts.island=createIsland(c,scale,mats);
  const {group:liftGroup,meshes:liftMeshes}=makeElevators(c,scale,mats);parts.elevators=liftGroup;
  parts.hangar=new THREE.Group();parts.hangar.name='Hangar_Study';
  addBox(parts.hangar,'Hangar_Floor_Study',[29,.6,222],[0,3.2,2],mats.support);
  const hangarSides=[-14.6,14.6];for(const x of hangarSides){
    for(const z of [-105,-70,-35,0,35,70,105])parts.hangar.add(stick(new THREE.Vector3(x,3.5,z),new THREE.Vector3(x,8.9,z),.20,mats.edge));
  }
  parts.hangar.visible=false;
  const order=['hull','hangar','supports','deck','elevators','island'];
  for(const name of order)group.add(parts[name]);
  const yShift={hull:-6,hangar:3,supports:5,deck:10,elevators:11,island:20};
  const defaults={};for(const name of order)defaults[name]=parts[name].position.y;
  const controllers={
    setElevatorDrop(id,meters){
      const el=liftMeshes.get(id);if(!el) throw new Error(`Unknown elevator ${id}`);
      const clamped=Math.min(Math.max(0,Number(meters)||0),el.info.maxDrop);
      el.group.position.y=el.restY-clamped;
      return clamped;
    },
    setAllElevatorsDrop(meters){for(const id of liftMeshes.keys())this.setElevatorDrop(id,meters);},
    setExplode(fraction){const f=THREE.MathUtils.clamp(Number(fraction)||0,0,1);for(const name of order)parts[name].position.y=defaults[name]+yShift[name]*f;},
    setWireframe(isOn){group.traverse(node=>{if(node.isMesh){const mats=Array.isArray(node.material)?node.material:[node.material];for(const mat of mats)mat.wireframe=!!isOn;}});},
    setDeckMarkingsVisible(visible){deckMat.map=visible?texture:null;deckMat.needsUpdate=true;},
    setVisible(name,visible){if(!parts[name])throw new Error(`Unknown part ${name}`);parts[name].visible=!!visible;},
  };
  group.userData={model:'CV-63 V2.1',units:'m',source:'User-provided js.txt, revised approximations',xScale:scale};
  const metrics={sourceMaxSectionWidth:sourceWidth.width,deckXScale:scale,
    maxSectionWidth:maxDeckSectionWidth(polygon).width,
    deckLength:Math.max(...polygon.map(v=>v[1]))-Math.min(...polygon.map(v=>v[1])),
    loftStationCount:c.hull.stations.length,loftLongitudinalSegments:c.hull.longitudinalSegments};
  group.traverse(node=>{if(node.isMesh){node.castShadow=true;node.receiveShadow=true;}});
  return {group,parts,controllers,metrics,params:c};
}
export function createCV63KittyHawk(config={}) {return createCV63KittyHawkModel(config).group;}
export async function exportCV63ToGLB(carrierGroup, filename='USS_Kitty_Hawk_CV63_V21.glb') {
  const { GLTFExporter }=await import('three/addons/exporters/GLTFExporter.js');
  const exporter=new GLTFExporter();
  exporter.parse(carrierGroup,(buffer)=>{
    const url=URL.createObjectURL(new Blob([buffer],{type:'model/gltf-binary'}));
    const link=document.createElement('a');link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),5000);
  },err=>console.error('GLB Export Error:',err),{binary:true});
}
