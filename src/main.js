import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createShip, SHIP_LABELS } from "./ship.js";
import { PARTS, OVERVIEW, VIEWS } from "./data.js";
import { Animator } from "./anim/animator.js";
import { createSequences } from "./anim/sequences.js";
import { buildSea } from "./model/sea.js";
import { createEffects } from "./anim/effects.js";
import { SHIP, DECK_OUTLINE, ELEVATORS, ISLAND, ANGLED_DECK, CATAPULTS } from "./model/constants.js";

/* ══════════════════════════════════════════════════════════════
   DOM / GLOBAL STATE
   ══════════════════════════════════════════════════════════════ */

const stage = document.getElementById("stage");
const canvas = document.getElementById("scene");
const bootScreen = document.getElementById("boot-screen");
const bootBar = document.getElementById("boot-progress-bar");
const bootPercent = document.getElementById("boot-percent");
const bootStatus = document.getElementById("boot-status");
const explodeInput = document.getElementById("explode-range");
const explodeValue = document.getElementById("explode-value");
const readoutName = document.getElementById("readout-name");
const readoutCoords = document.getElementById("readout-coords");
const readoutStatus = document.querySelector(".readout-status");
const assemblyTree = document.getElementById("assembly-tree");
const assemblyCount = document.getElementById("assembly-count");
const meshCountEl = document.getElementById("mesh-count");
const dossierCode = document.getElementById("dossier-code");
const detailBody = document.getElementById("detail-body");
const isolateButton = document.getElementById("isolate-selected");
const helpModal = document.getElementById("help-modal");
const toast = document.getElementById("toast");
const motionStatus = document.getElementById("motion-status");
const motionProgress = document.getElementById("motion-progress-bar");
const motionPlay = document.getElementById("motion-play");
const motionStop = document.getElementById("motion-stop");
const motionSpeed = document.getElementById("motion-speed");
const motionButtons = [...document.querySelectorAll("[data-seq]")];

const state = {
  explode: 0.32,
  targetExplode: 0,
  section: false,
  wireframe: false,
  labels: true,
  autoRotate: false,
  selectedId: null,
  isolatedId: null,
  hoveredId: null,
  labelsReady: false,
  activeView: "overview",
  dragging: false,
  booted: false,
  cinematic: false,
};

let animator;
let effects;
let sea;
let api;
let sequenceApi;
let seaAllowed = true;

let scene;
let camera;
let renderer;
let controls;
let composer;
let labelRenderer;
let ship;
let sectionGuide;
let sectionPlane;
let dimensionGuide;
let selectionBox;
let selectionHelper;
let raycaster;
let pointerNdc;
let lastPointer = { x: 0, y: 0 };
let pointerDown = null;
let hoverDirty = false;
let lastHoverPick = 0;
let cameraTween = null;
let toastTimer = null;
let guideLabels = [];
let partLabels = [];
let shipMaterials = [];
const partMap = new Map(PARTS.map((part) => [part.id, part]));
let lastFrameTime = performance.now();

const EYE_OPEN = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.4-5 9.5-5 9.5 5 9.5 5-3.4 5-9.5 5-9.5-5-9.5-5Z"></path><circle cx="12" cy="12" r="2.6"></circle></svg>`;
const EYE_OFF = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 4.5 20.5 19.5M9.9 7.3A10.9 10.9 0 0 1 12 7c6.1 0 9.5 5 9.5 5a16.6 16.6 0 0 1-3.2 3.1M6.4 8.5A17 17 0 0 0 2.5 12s3.4 5 9.5 5a10 10 0 0 0 3.4-.55"></path><path d="M10.3 10.2a2.5 2.5 0 0 0 3.5 3.5"></path></svg>`;

const PART_ICONS = {
  hull: `<svg viewBox="0 0 24 24"><path d="M3 14h18l-3.2 5H6.2L3 14Z"></path><path d="M7 14V9h10v5M9 9V5.8h6V9M12 5.8V3"></path><path d="M3 14h18"></path></svg>`,
  deck: `<svg viewBox="0 0 24 24"><path d="M2.5 16.5h19l-3.4 4H6.2l-3.7-4Z"></path><path d="m9 16.5 7-8h3M5 12.5l8.5-9h2.2M15 12h5M7 20.5v-2M17 20.5v-2"></path></svg>`,
  island: `<svg viewBox="0 0 24 24"><path d="M6 21h12M8 21V8h8v13M9.5 8V4h5v4M12 4V1.8M8.5 11h7M8.5 14.5h7M8.5 18h7"></path><path d="m6 6 4-2M18 6l-4-2"></path></svg>`,
  hangar: `<svg viewBox="0 0 24 24"><path d="M3 20V7l9-4 9 4v13M3 20h18M6.5 20V9.3h11V20M6.5 13h11M6.5 16.5h11"></path></svg>`,
  engine: `<svg viewBox="0 0 24 24"><path d="M4 9.5h9a5 5 0 0 1 0 10H4v-10Z"></path><path d="M13 14.5h7M4 12H1.5M4 17H1.5M9 9.5V6M6.5 9.5V6M16 7.5l2.5-2M18 12h4M18 17h4"></path><circle cx="8.5" cy="14.5" r="2.5"></circle></svg>`,
  jet: `<svg viewBox="0 0 24 24"><path d="m12 2 2.2 7.2 6.8 4.1v2.1l-6.7-2.2-.8 4.4 2.4 1.9v1.2L12 19.6l-3.9 1.1v-1.2l2.4-1.9-.8-4.4L3 15.4v-2.1l6.8-4.1L12 2Z"></path></svg>`,
  weapon: `<svg viewBox="0 0 24 24"><path d="M3 18h18M5 18v-3.5h5V18M14 18v-5h5v5"></path><path d="M7.5 14.5v-5h9v5M10 9.5V6h4v3.5M12 6V3"></path><circle cx="12" cy="12" r="1.2"></circle></svg>`,
  frame: `<svg viewBox="0 0 24 24"><path d="M3 4h18v16H3V4ZM3 9h18M3 15h18M8 4v16M16 4v16"></path><path d="m3 4 5 5M21 4l-5 5M3 20l5-5M21 20l-5-5"></path></svg>`,
  elevator: `<svg viewBox="0 0 24 24"><path d="M4 6h16M4 18h16M8 6v12M16 6v12"></path><path d="M12 9v6M9.5 11.5 12 9l2.5 2.5M9.5 14.5 12 17l2.5-2.5"></path></svg>`,
};

/* ══════════════════════════════════════════════════════════════
   RENDER / SCENE
   ══════════════════════════════════════════════════════════════ */

function initRenderer() {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.94;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.localClippingEnabled = true;
  renderer.setClearColor(0x04080d, 1);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04080d);
  scene.fog = new THREE.FogExp2(0x050b10, 0.00105);

  camera = new THREE.PerspectiveCamera(33, window.innerWidth / window.innerHeight, 0.5, 5000);
  camera.position.set(450, 276, 520);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 27, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.055;
  controls.rotateSpeed = 0.58;
  controls.zoomSpeed = 0.82;
  controls.panSpeed = 0.55;
  controls.minDistance = 70;
  controls.maxDistance = 1200;
  controls.minPolarAngle = 0.06;
  controls.maxPolarAngle = Math.PI * 0.52;
  controls.autoRotateSpeed = 0.46;
  controls.screenSpacePanning = false;
  controls.enablePan = true;

  composer = new EffectComposer(renderer);
  composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  composer.setSize(window.innerWidth, window.innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(
    new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.24, 0.5, 0.9),
  );
  composer.addPass(new OutputPass());

  labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.id = "css2d-layer";
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  stage.appendChild(labelRenderer.domElement);

  buildEnvironment();
  buildLights();
  buildWorkbench();
  setupInteractionEvents();
}

function buildEnvironment() {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.035).texture;
  scene.environmentIntensity = 0.45;
  room.dispose?.();
  pmrem.dispose();

  const skyGeometry = new THREE.SphereGeometry(1700, 32, 18);
  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec3 direction = normalize(vWorldPosition);
        float height = direction.y;
        vec3 bottom = vec3(0.0025, 0.006, 0.010);
        vec3 horizon = vec3(0.013, 0.030, 0.042);
        vec3 top = vec3(0.006, 0.016, 0.028);
        vec3 color = mix(bottom, horizon, smoothstep(-0.6, 0.02, height));
        color = mix(color, top, smoothstep(-0.12, 0.72, height) * 0.7);
        float band = exp(-pow((height + 0.01) * 12.0, 2.0));
        color += vec3(0.08, 0.19, 0.24) * band * 0.22;
        float glow = pow(max(0.0, 1.0 - abs(direction.x - 0.28) * 2.2), 16.0);
        color += vec3(0.12, 0.10, 0.06) * glow * 0.18;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  scene.add(new THREE.Mesh(skyGeometry, skyMaterial));

  const dustCount = 900;
  const positions = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    const radius = 160 + Math.random() * 780;
    const angle = Math.random() * Math.PI * 2;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = -30 + Math.random() * 300;
    positions[i * 3 + 2] = Math.sin(angle) * radius;
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  scene.add(
    new THREE.Points(
      dustGeometry,
      new THREE.PointsMaterial({
        color: 0x8dc3d8,
        size: 0.85,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    ),
  );
}

function buildLights() {
  scene.add(new THREE.HemisphereLight(0x9bcce7, 0x04070a, 0.85));

  const key = new THREE.DirectionalLight(0xe4f2f7, 2.15);
  key.position.set(300, 360, 260);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -330;
  key.shadow.camera.right = 330;
  key.shadow.camera.top = 330;
  key.shadow.camera.bottom = -330;
  key.shadow.camera.near = 80;
  key.shadow.camera.far = 1000;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.42;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x5d9fbd, 0.95);
  fill.position.set(-300, 160, -220);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffb37b, 0.65);
  rim.position.set(-90, 35, 420);
  scene.add(rim);

  const sternGlow = new THREE.PointLight(0xffa568, 80, 190, 2.1);
  sternGlow.position.set(-25, 22, 145);
  scene.add(sternGlow);
}

function buildWorkbench() {
  const floorY = -78;
  const grid = new THREE.GridHelper(1100, 110, 0x2d5a70, 0x112732);
  grid.position.y = floorY;
  grid.material.transparent = true;
  grid.material.opacity = 0.33;
  grid.material.depthWrite = false;
  scene.add(grid);

  const ringMaterial = new THREE.LineBasicMaterial({
    color: 0x5ca7c1,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
  });
  [185, 240, 310].forEach((radius) => {
    const points = [];
    for (let i = 0; i < 128; i++) {
      const angle = (i / 128) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(angle) * radius, floorY + 0.05, Math.sin(angle) * radius));
    }
    scene.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), ringMaterial));
  });

  const tickPoints = [];
  for (let i = 0; i < 72; i++) {
    const angle = (i / 72) * Math.PI * 2;
    const inner = i % 6 === 0 ? 302 : 307;
    tickPoints.push(
      new THREE.Vector3(Math.cos(angle) * inner, floorY + 0.08, Math.sin(angle) * inner),
      new THREE.Vector3(Math.cos(angle) * 314, floorY + 0.08, Math.sin(angle) * 314),
    );
  }
  scene.add(
    new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(tickPoints),
      new THREE.LineBasicMaterial({ color: 0x5ca7c1, transparent: true, opacity: 0.22, depthWrite: false }),
    ),
  );

  const axisPoints = [
    new THREE.Vector3(-480, floorY + 0.1, 0),
    new THREE.Vector3(480, floorY + 0.1, 0),
    new THREE.Vector3(0, floorY + 0.1, -480),
    new THREE.Vector3(0, floorY + 0.1, 480),
  ];
  scene.add(
    new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(axisPoints),
      new THREE.LineBasicMaterial({ color: 0x4e91aa, transparent: true, opacity: 0.18, depthWrite: false }),
    ),
  );

  dimensionGuide = new THREE.Group();
  const dimensionY = -25;
  const dimensionX = 54;
  const dimensionPoints = [
    new THREE.Vector3(dimensionX, dimensionY, -162),
    new THREE.Vector3(dimensionX, dimensionY, 162),
  ];
  for (let z = -160; z <= 160; z += 20) {
    const length = z % 100 === 0 ? 3.2 : 1.7;
    dimensionPoints.push(
      new THREE.Vector3(dimensionX - length, dimensionY, z),
      new THREE.Vector3(dimensionX + length, dimensionY, z),
    );
  }
  dimensionPoints.push(
    new THREE.Vector3(dimensionX - 2.4, dimensionY - 3.2, -162),
    new THREE.Vector3(dimensionX + 2.4, dimensionY + 3.2, -162),
    new THREE.Vector3(dimensionX - 2.4, dimensionY - 3.2, 162),
    new THREE.Vector3(dimensionX + 2.4, dimensionY + 3.2, 162),
  );
  dimensionGuide.add(
    new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(dimensionPoints),
      new THREE.LineBasicMaterial({ color: 0x72bdd7, transparent: true, opacity: 0.36, depthWrite: false }),
    ),
  );
  const beamPoints = [
    new THREE.Vector3(-38.4, dimensionY, 184),
    new THREE.Vector3(38.4, dimensionY, 184),
    new THREE.Vector3(-38.4, dimensionY - 2.5, 184),
    new THREE.Vector3(-38.4, dimensionY + 2.5, 184),
    new THREE.Vector3(38.4, dimensionY - 2.5, 184),
    new THREE.Vector3(38.4, dimensionY + 2.5, 184),
  ];
  for (let x = -30; x <= 30; x += 10) {
    beamPoints.push(new THREE.Vector3(x, dimensionY, 182.8), new THREE.Vector3(x, dimensionY, 185.2));
  }
  dimensionGuide.add(
    new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(beamPoints),
      new THREE.LineBasicMaterial({ color: 0x72bdd7, transparent: true, opacity: 0.3, depthWrite: false }),
    ),
  );
  dimensionGuide.userData.labelAnchor = new THREE.Vector3(56, -19, 0);
  scene.add(dimensionGuide);

  sectionGuide = new THREE.Group();
  sectionGuide.visible = false;
  sectionPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 1.6);

  const sectionPlaneGeometry = new THREE.PlaneGeometry(324, 92);
  sectionPlaneGeometry.rotateY(Math.PI / 2);
  const sectionFill = new THREE.Mesh(
    sectionPlaneGeometry,
    new THREE.MeshBasicMaterial({
      color: 0x4cc5e6,
      transparent: true,
      opacity: 0.045,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  sectionFill.position.set(1.6, 16, 0);
  sectionGuide.add(sectionFill);

  const sectionGridPoints = [];
  for (let z = -160; z <= 160; z += 20) {
    sectionGridPoints.push(new THREE.Vector3(1.62, -24, z), new THREE.Vector3(1.62, 52, z));
  }
  for (let y = -20; y <= 50; y += 10) {
    sectionGridPoints.push(new THREE.Vector3(1.62, y, -160), new THREE.Vector3(1.62, y, 160));
  }
  sectionGuide.add(
    new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(sectionGridPoints),
      new THREE.LineBasicMaterial({ color: 0x59c7e5, transparent: true, opacity: 0.22, depthWrite: false }),
    ),
  );
  const sectionBorder = [
    new THREE.Vector3(1.62, -24, -160),
    new THREE.Vector3(1.62, -24, 160),
    new THREE.Vector3(1.62, 52, 160),
    new THREE.Vector3(1.62, 52, -160),
  ];
  sectionGuide.add(
    new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(sectionBorder),
      new THREE.LineBasicMaterial({ color: 0x6adcf5, transparent: true, opacity: 0.5, depthWrite: false }),
    ),
  );
  sectionGuide.userData.labelAnchor = new THREE.Vector3(2.2, 56, 65);
  scene.add(sectionGuide);
}

function createGuideLabel(text, sub) {
  const element = document.createElement("div");
  element.className = "dimension-tag";
  element.innerHTML = `<b>${text}</b><small>${sub}</small>`;
  const object = new CSS2DObject(element);
  element.style.pointerEvents = "none";
  return object;
}

/* ══════════════════════════════════════════════════════════════
   BUILD SHIP / LABELS
   ══════════════════════════════════════════════════════════════ */

function buildShipScene() {
  animator = new Animator({});
  ship = createShip(animator);
  scene.add(ship.root);
  meshCountEl.textContent = String(ship.meshCount);

  const materialSet = new Set();
  ship.root.traverse((object) => {
    if (!object.material) return;
    const mats = Array.isArray(object.material) ? object.material : [object.material];
    mats.forEach((mat) => materialSet.add(mat));
  });
  shipMaterials = [...materialSet];

  // 海面与粒子特效
  try {
    sea = buildSea(scene, { anim: animator, materials: ship.materials, renderer, camera, scene });
    if (sea?.root) sea.root.userData.noClip = true;
  } catch (error) {
    console.warn("sea unavailable", error);
  }
  try {
    effects = createEffects({ anim: animator, materials: ship.materials, scene, renderer, camera });
  } catch (error) {
    console.warn("effects unavailable", error);
  }

  selectionBox = new THREE.Box3();
  selectionHelper = new THREE.Box3Helper(selectionBox, 0x63e7ff);
  selectionHelper.material.transparent = true;
  selectionHelper.material.opacity = 0.34;
  selectionHelper.material.depthTest = false;
  selectionHelper.material.depthWrite = false;
  selectionHelper.renderOrder = 30;
  selectionHelper.visible = false;
  scene.add(selectionHelper);

  addPartLabels();
  addGuideLabels();
  buildAnimatorApi();
  createSequences(api);
  setupMotionUI();

  // 常驻动效：锅炉烟、艏波
  const island = ship.handles.island;
  effects?.funnelSmoke(new THREE.Vector3(31.4, (island?.funnelTop ?? 37.2) + 0.6, island?.funnelZ ?? -30.5));
  effects?.bowSpray(new THREE.Vector3(0, 1.4, -148));

  window.__CV63 = { ship, scene, camera, controls, state, THREE, applyView, setExplode, setSection, animator, api };
  window.cv = {
    ready: () => state.booted,
    app: window.__CV63,
    animator,
    api,
    play: (name) => playSequence(name),
    stop: () => animator.stop(),
    view: (key) => applyView(key),
    state,
    /** 调试/截图用：脱离 rAF 手动推进模拟并渲染一帧 */
    advance: (seconds, step = 1 / 60) => {
      let remaining = Math.max(0, seconds);
      let guard = 0;
      while (remaining > 1e-4 && guard < 20000) {
        const dt = Math.min(step, remaining);
        simulate(dt);
        remaining -= dt;
        guard++;
      }
      renderFrame();
      return animator.time;
    },
    render: () => {
      renderFrame();
    },
    select: (id) => selectPart(id),
    stats: () => ({
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      meshes: ship.meshCount,
      errors: window.__cvErrors?.length ?? 0,
    }),
  };
}

/* ── 动效 API ─────────────────────────────────────────────── */

function setCameraPose(position, target) {
  cameraTween = null;
  camera.position.set(...position);
  controls.target.set(...target);
  controls.update();
}

function setCinematic(enabled) {
  state.cinematic = Boolean(enabled);
  if (state.cinematic) seaAllowed = true;
  controls.enabled = !state.cinematic;
  controls.autoRotate = false;
  if (state.cinematic) document.querySelector('[data-toggle="autorotate"]')?.setAttribute("aria-pressed", "false");
  stage.classList.toggle("is-cinematic", state.cinematic);
}

function buildAnimatorApi() {
  const handle = ship.handles;
  const fx = {
    steamBurst: (position, options) => effects?.steamBurst(position, options),
    funnelSmoke: (position) => effects?.funnelSmoke(position),
    bowSpray: (position) => effects?.bowSpray(position),
    stopFunnel: () => effects?.stopFunnel?.(),
    stopSpray: () => effects?.stopSpray?.(),
    startCruise: () => {
      effects?.funnelSmoke(new THREE.Vector3(31.4, (handle.island?.funnelTop ?? 37.2) + 0.6, handle.island?.funnelZ ?? -30.5));
      effects?.bowSpray(new THREE.Vector3(0, 1.4, -148));
    },
    stopCruise: () => {
      effects?.stopFunnel?.();
      effects?.stopSpray?.();
    },
    startCatapult: () => {},
    stopCatapult: () => {},
    startRecovery: () => {},
    stopRecovery: () => {},
  };

  api = {
    animator,
    ship,
    scene,
    camera,
    airwing: handle.airwing,
    elevators: handle.elevators,
    island: handle.island,
    effects: fx,
    setExplode: (value) => setExplode(value),
    getExplode: () => state.explode,
    setJbd: (catId, value) => {
      const hinge = animator.get(`jbd:${catId}`);
      if (hinge) hinge.rotation.x = 1.18 * THREE.MathUtils.clamp(value, 0, 1);
    },
    toast: showToast,
    camera: {
      set: setCameraPose,
      flyTo: (position, target, duration = 1.4) => flyTo(position, target, duration),
      setCinematic,
      reset: (duration = 1.4) => {
        setCinematic(false);
        flyTo(VIEWS.overview.position, VIEWS.overview.target, duration);
      },
    },
  };
  animator.api = api;
  sequenceApi = api;
}

/* ── 动效面板 ─────────────────────────────────────────────── */

function setupMotionUI() {
  if (!animator || !motionStatus) return;

  motionButtons.forEach((button) => {
    button.addEventListener("click", () => playSequence(button.dataset.seq));
  });

  motionPlay?.addEventListener("click", () => {
    if (!animator.active) {
      playSequence(motionButtons[0]?.dataset.seq ?? "cruise");
      return;
    }
    animator.setPaused(!animator.paused);
  });

  motionStop?.addEventListener("click", () => {
    animator.stop();
    showToast("动效已停止 / MOTION HALT");
  });

  motionSpeed?.addEventListener("input", (event) => {
    animator.setSpeed(Number(event.target.value));
  });

  animator.onState = ({ active, label, progress, paused }) => {
    motionStatus.textContent = active ? `${paused ? "PAUSED" : "RUNNING"} · ${label}` : "STANDBY / 待机";
    motionStatus.classList.toggle("is-live", Boolean(active) && !paused);
    motionProgress.style.width = `${Math.round(progress * 100)}%`;
    motionButtons.forEach((button) => {
      const isActive = button.dataset.seq === active;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
    if (motionPlay) {
      motionPlay.classList.toggle("is-playing", Boolean(active) && !paused);
      motionPlay.setAttribute("aria-label", paused ? "继续" : "暂停");
    }
  };
  animator.onState({ active: null, label: null, progress: 0, paused: false });

  animator.api.onSequenceStart = (definition) => showToast(`动效启动 / ${definition.label}`);
  animator.api.onSequenceEnd = (definition) => showToast(`动效结束 / ${definition.label}`);
}

function playSequence(name) {
  if (!animator || !name) return;
  if (animator.active?.definition.name === name && !animator.paused) {
    animator.stop();
    return;
  }
  const ok = animator.play(name);
  if (!ok) showToast(`未找到动效 / ${name}`);
}

function addPartLabels() {
  const groups = ship.groups;
  SHIP_LABELS.forEach((definition, index) => {
    const group = groups[definition.groupId];
    if (!group) return;
    const element = document.createElement("div");
    element.className = `tech-label${definition.side === "left" ? " is-left" : ""}`;
    element.style.setProperty("--label-color", partMap.get(definition.groupId)?.color ?? "#63e7ff");
    element.innerHTML = `
      <span class="label-dot" aria-hidden="true"></span>
      <span class="label-line" aria-hidden="true"></span>
      <span class="label-copy">
        <b>${definition.title}</b>
        <small>${definition.en}</small>
      </span>
    `;
    const object = new CSS2DObject(element);
    object.position.set(...definition.position);
    object.userData.labelIndex = index;
    group.add(object);
    element.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      selectPart(definition.groupId);
    });
    element.addEventListener("pointerdown", (event) => event.stopPropagation());
    partLabels.push({ element, object, definition, groupId: definition.groupId });
  });
}

function addGuideLabels() {
  const dimensionLabel = createGuideLabel("L.O.A. 323.8 M", "DIM-01 / OVERALL LENGTH");
  dimensionLabel.position.copy(dimensionGuide.userData.labelAnchor);
  dimensionGuide.add(dimensionLabel);
  guideLabels.push({ object: dimensionLabel, type: "dimension", element: dimensionLabel.element });

  const sectionLabel = createGuideLabel("SECTION A—A", "LONGITUDINAL CUT / X = 1.6 M");
  sectionLabel.position.copy(sectionGuide.userData.labelAnchor);
  sectionGuide.add(sectionLabel);
  guideLabels.push({ object: sectionLabel, type: "section", element: sectionLabel.element });
}

/* ══════════════════════════════════════════════════════════════
   UI / ASSEMBLY TREE
   ══════════════════════════════════════════════════════════════ */

function buildAssemblyTree() {
  PARTS.forEach((part) => {
    const row = document.createElement("div");
    row.className = "assembly-row";
    row.dataset.partId = part.id;
    row.style.setProperty("--part-color", part.color);
    row.innerHTML = `
      <button class="row-select" type="button" aria-label="查看${part.name}档案">
        <span class="tree-node" aria-hidden="true"></span>
        <span class="part-index">${part.index}</span>
        <span class="part-name"><b>${part.name}</b><small>${part.en}</small></span>
        <span class="part-badge">${part.badge}</span>
      </button>
      <button class="eye-toggle" type="button" aria-label="隐藏${part.name}" aria-pressed="false">${EYE_OPEN}</button>
    `;
    const selectButton = row.querySelector(".row-select");
    const eyeButton = row.querySelector(".eye-toggle");
    selectButton.addEventListener("click", () => selectPart(part.id));
    selectButton.addEventListener("dblclick", () => {
      selectPart(part.id);
      focusPart(part.id);
    });
    eyeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleGroupVisibility(part.id);
    });
    assemblyTree.appendChild(row);
  });
  updateAssemblyVisibilityUI();
}

function updateAssemblyVisibilityUI() {
  let visibleCount = 0;
  PARTS.forEach((part) => {
    const row = assemblyTree.querySelector(`[data-part-id="${part.id}"]`);
    const group = ship?.groups?.[part.id];
    if (!row || !group) return;
    const visible = group.visible;
    if (visible) visibleCount++;
    row.classList.toggle("is-hidden", !visible);
    row.classList.toggle("is-active", state.selectedId === part.id);
    const eye = row.querySelector(".eye-toggle");
    eye.innerHTML = visible ? EYE_OPEN : EYE_OFF;
    eye.setAttribute("aria-pressed", String(!visible));
    eye.setAttribute("aria-label", visible ? `隐藏${part.name}` : `显示${part.name}`);
  });
  assemblyCount.textContent = `${String(visibleCount).padStart(2, "0")} / ${String(PARTS.length).padStart(2, "0")}`;
  document.getElementById("module-count").textContent = String(visibleCount).padStart(2, "0");
  isolateButton.disabled = !state.selectedId;
  const isolateLabel = state.isolatedId ? "退出聚焦" : "聚焦所选";
  isolateButton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"></path><circle cx="12" cy="12" r="3"></circle></svg> ${isolateLabel}`;
}

function toggleGroupVisibility(id) {
  const group = ship?.groups?.[id];
  if (!group) return;
  group.visible = !group.visible;
  if (!group.visible && state.selectedId === id) clearSelection();
  if (state.isolatedId && id !== state.isolatedId) state.isolatedId = null;
  updateAssemblyVisibilityUI();
  updateLabels();
  updateSelectionHelper();
  showToast(`${group.visible ? "显示" : "隐藏"} / ${partMap.get(id).name}`);
}

function showAllGroups() {
  Object.values(ship?.groups ?? {}).forEach((group) => {
    group.visible = true;
  });
  state.isolatedId = null;
  updateAssemblyVisibilityUI();
  updateLabels();
  updateSelectionHelper();
  if (state.selectedId) renderDetail(state.selectedId);
  showToast("全部模块已显示 / ALL MODULES ONLINE");
}

function isolateSelected() {
  if (!state.selectedId) return;
  if (state.isolatedId === state.selectedId) {
    showAllGroups();
    return;
  }
  PARTS.forEach((part) => {
    ship.groups[part.id].visible = part.id === state.selectedId;
  });
  state.isolatedId = state.selectedId;
  updateAssemblyVisibilityUI();
  updateLabels();
  updateSelectionHelper();
  renderDetail(state.selectedId);
  showToast(`聚焦模式 / ${partMap.get(state.selectedId).name}`);
}

function selectPart(id, options = {}) {
  if (id && !partMap.has(id)) return;
  if (state.isolatedId && id !== state.isolatedId) {
    Object.values(ship?.groups ?? {}).forEach((group) => {
      group.visible = true;
    });
    state.isolatedId = null;
  }
  state.selectedId = id;
  document.body.classList.toggle("has-selection", Boolean(id));
  if (id) {
    const group = ship.groups[id];
    if (group) group.visible = true;
  }
  updateAssemblyVisibilityUI();
  updateLabels();
  updateSelectionHelper();
  renderDetail(id);
  updateReadout(id);
  if (options.fly && id) focusPart(id);
}

function clearSelection() {
  selectPart(null);
}

function updateSelectionHelper() {
  if (!selectionHelper) return;
  if (!state.selectedId || state.section) {
    selectionHelper.visible = false;
    return;
  }
  const group = ship.groups[state.selectedId];
  if (!group || !group.visible) {
    selectionHelper.visible = false;
    return;
  }
  scene.updateMatrixWorld(true);
  selectionBox.setFromObject(group);
  selectionHelper.material.color.set(partMap.get(state.selectedId)?.color ?? "#63e7ff");
  selectionHelper.visible = true;
}

function updateLabels() {
  const t = state.explode;
  const sectionHidden = new Set(["island", "weapons", "airwing"]);
  partLabels.forEach((label) => {
    const group = ship?.groups?.[label.groupId];
    const groupVisible = group?.visible !== false;
    const meetsThreshold = t >= (label.definition.minExplode ?? 0) - 0.015;
    const sectionAllowed = !(state.section && sectionHidden.has(label.groupId));
    const selectedBoost = state.selectedId === label.groupId;
    const sectionBoost = state.section && label.groupId === "hangar";
    const visible = state.labelsReady && state.labels && groupVisible && sectionAllowed && (selectedBoost || sectionBoost || (!label.definition.secondary && meetsThreshold));
    label.element.classList.toggle("is-visible", visible);
    label.element.classList.toggle("is-active", state.selectedId === label.groupId);
    label.element.style.pointerEvents = visible ? "auto" : "none";
  });
  guideLabels.forEach((label) => {
    const visible = state.labelsReady && (label.type === "section" ? state.section : state.labels);
    label.element.classList.toggle("is-visible", visible);
    label.element.style.pointerEvents = "none";
  });
}

/* ══════════════════════════════════════════════════════════════
   DETAIL DOSSIER
   ══════════════════════════════════════════════════════════════ */

function shipPlanSVG() {
  const px = (z) => 10 + ((z + 162) / 324) * 300; // bow → stern
  const py = (x) => 46 + (x / 41) * 34; // port → starboard
  const outline =
    DECK_OUTLINE.map(([x, z], index) => `${index === 0 ? "M" : "L"}${px(z).toFixed(1)} ${py(x).toFixed(1)}`).join(" ") +
    " Z";

  const elevators = ELEVATORS.map((elevator) => {
    const z0 = px(elevator.z - elevator.length / 2);
    const z1 = px(elevator.z + elevator.length / 2);
    const x0 = py(elevator.inner);
    const x1 = py(elevator.edge);
    return `<rect x="${Math.min(z0, z1).toFixed(1)}" y="${Math.min(x0, x1).toFixed(1)}" width="${Math.abs(z1 - z0).toFixed(1)}" height="${Math.abs(x1 - x0).toFixed(1)}" fill="none" stroke="#ffbd6f" stroke-width=".6" opacity=".7"/>`;
  }).join("");

  const islandRect = (() => {
    const z0 = px(ISLAND.z - ISLAND.length / 2);
    const z1 = px(ISLAND.z + ISLAND.length / 2);
    const x0 = py(ISLAND.x - ISLAND.width / 2);
    const x1 = py(ISLAND.x + ISLAND.width / 2);
    return `<rect x="${z0.toFixed(1)}" y="${Math.min(x0, x1).toFixed(1)}" width="${(z1 - z0).toFixed(1)}" height="${Math.abs(x1 - x0).toFixed(1)}" fill="#dceaf0" fill-opacity=".1" stroke="#8fd3e8" stroke-width=".7"/>`;
  })();

  // 斜角甲板着舰区
  const stern = ANGLED_DECK.centerStern;
  const bow = ANGLED_DECK.centerBow;
  const dx = bow[0] - stern[0];
  const dz = bow[1] - stern[1];
  const len = Math.hypot(dx, dz);
  const nx = -dz / len;
  const nz = dx / len;
  const half = ANGLED_DECK.width / 2;
  const corners = [
    [stern[0] + nx * half, stern[1] + nz * half],
    [bow[0] + nx * half, bow[1] + nz * half],
    [bow[0] - nx * half, bow[1] - nz * half],
    [stern[0] - nx * half, stern[1] - nz * half],
  ]
    .map(([x, z], index) => `${index === 0 ? "M" : "L"}${px(z).toFixed(1)} ${py(x).toFixed(1)}`)
    .join(" ");
  const centerline = `<path d="M${px(stern[1])} ${py(stern[0])} L${px(bow[1])} ${py(bow[0])}" stroke="#dceaf0" stroke-width=".55" stroke-dasharray="4 3" opacity=".65"/>`;
  const wires = ANGLED_DECK.wiresZ.map((wz) => {
    const t = (wz - stern[1]) / dz;
    const cx = stern[0] + dx * t;
    return `<line x1="${px(wz - nz * half).toFixed(1)}" y1="${py(cx - nx * half).toFixed(1)}" x2="${px(wz + nz * half).toFixed(1)}" y2="${py(cx + nx * half).toFixed(1)}" stroke="#dceaf0" stroke-width=".45" opacity=".55"/>`;
  }).join("");
  const cats = CATAPULTS.map((cat) => {
    return `<line x1="${px(cat.start[1]).toFixed(1)}" y1="${py(cat.start[0]).toFixed(1)}" x2="${px(cat.end[1]).toFixed(1)}" y2="${py(cat.end[0]).toFixed(1)}" stroke="#ffbd6f" stroke-width=".55" stroke-dasharray="5 3" opacity=".7"/>`;
  }).join("");

  return `
    <svg viewBox="0 0 320 96" aria-hidden="true">
      <defs>
        <linearGradient id="planFill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#5ddcf7" stop-opacity=".16"/>
          <stop offset="1" stop-color="#5ddcf7" stop-opacity=".025"/>
        </linearGradient>
      </defs>
      <path d="${outline}" fill="url(#planFill)" stroke="#6fc9e5" stroke-width="1.1"/>
      <path d="${corners} Z" fill="#dceaf0" fill-opacity=".035" stroke="#dceaf0" stroke-opacity=".32" stroke-width=".45"/>
      ${centerline}
      ${wires}
      ${cats}
      ${elevators}
      ${islandRect}
      <text x="${px(-148).toFixed(1)}" y="${(py(0) + 4).toFixed(1)}" fill="#dceaf0" fill-opacity=".45" font-size="12" font-family="monospace" text-anchor="middle">63</text>
      <text x="160" y="92" fill="#6f8d9b" font-size="5.5" font-family="monospace" text-anchor="middle" letter-spacing="1.2">FLIGHT DECK / 9° SKEW · 4 ELEVATORS</text>
    </svg>
    <span class="plan-label">PLAN / TOP VIEW</span>
  `;
}

function renderOverview() {
  dossierCode.textContent = "CV-63";
  detailBody.innerHTML = `
    <div class="dossier-overview">
      <div class="dossier-kicker">${OVERVIEW.kicker}</div>
      <h2 class="dossier-title">${OVERVIEW.title}<small>${OVERVIEW.subtitle}</small></h2>
      <p class="dossier-subtitle">${OVERVIEW.description}</p>
      <div class="ship-plan">${shipPlanSVG()}</div>
      <div class="fact-grid">
        ${OVERVIEW.facts.map(([label, value]) => `<div class="fact"><span>${label}</span><b>${value}</b></div>`).join("")}
      </div>
      <div class="section-label">ARCHIVE TAGS / 档案标签</div>
      <div class="tag-row">${OVERVIEW.tags.map((tag) => `<span class="dossier-tag">${tag}</span>`).join("")}</div>
      <div class="dossier-note">${OVERVIEW.note}</div>
      <div class="section-label">START HERE / 开始拆解</div>
      <p class="part-desc" style="margin-bottom:0">从左侧装配树选择一个模块，或在视图中点击构件。拖动下方“爆炸拆解”滑杆，观察舰体、飞行甲板、舰岛、动力系统与舰载机的空间分离。</p>
    </div>
  `;
  detailBody.scrollTop = 0;
}

function renderDetail(id) {
  if (!id) {
    renderOverview();
    return;
  }
  const part = partMap.get(id);
  if (!part) {
    renderOverview();
    return;
  }
  dossierCode.textContent = part.code;
  const isolated = state.isolatedId === id;
  detailBody.innerHTML = `
    <div class="dossier-overview" style="--part-color:${part.color}">
      <div class="part-hero">
        <div class="part-icon">${PART_ICONS[part.icon] ?? PART_ICONS.frame}</div>
        <div class="part-hero-copy">
          <div class="part-code">${part.code} / ${part.badge}</div>
          <h3>${part.name}<small>${part.en}</small></h3>
        </div>
      </div>
      <div class="dossier-kicker">${part.kicker}</div>
      <p class="part-desc">${part.description}</p>
      <div class="section-label">KEY DATA / 关键数据</div>
      <dl class="spec-list">
        ${part.specs.map(([label, value]) => `<div class="spec-row"><dt>${label}</dt><dd>${value}</dd></div>`).join("")}
      </dl>
      <div class="section-label">SUBSYSTEMS / 组成</div>
      <div class="tag-row">${part.tags.map((tag) => `<span class="dossier-tag">${tag}</span>`).join("")}</div>
      <div class="detail-actions">
        <button class="action-button" type="button" data-action="focus">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4"></path><circle cx="12" cy="12" r="4.2"></circle></svg>
          镜头定位
        </button>
        <button class="action-button" type="button" data-action="isolate">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"></path><circle cx="12" cy="12" r="3"></circle></svg>
          ${isolated ? "退出聚焦" : "聚焦此层"}
        </button>
      </div>
      <div class="dossier-note">${part.note}</div>
    </div>
  `;
  detailBody.scrollTop = 0;
}

function updateReadout(id) {
  if (!id) {
    readoutName.textContent = "WHOLE SHIP / 整舰";
    return;
  }
  const part = partMap.get(id);
  readoutName.textContent = `${part.name} / ${part.en}`;
}

/* ══════════════════════════════════════════════════════════════
   CAMERA / MODES
   ══════════════════════════════════════════════════════════════ */

function flyTo(position, target, duration = 1.4) {
  cameraTween = {
    fromPosition: camera.position.clone(),
    toPosition: new THREE.Vector3(...position),
    fromTarget: controls.target.clone(),
    toTarget: new THREE.Vector3(...target),
    start: performance.now(),
    duration: duration * 1000,
  };
}

function updateCameraTween(now) {
  if (!cameraTween) return;
  const raw = THREE.MathUtils.clamp((now - cameraTween.start) / cameraTween.duration, 0, 1);
  const t = raw < 0.5 ? 4 * raw * raw * raw : 1 - Math.pow(-2 * raw + 2, 3) / 2;
  camera.position.lerpVectors(cameraTween.fromPosition, cameraTween.toPosition, t);
  controls.target.lerpVectors(cameraTween.fromTarget, cameraTween.toTarget, t);
  if (raw >= 1) cameraTween = null;
}

function fitView(view) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  let scale = 1;
  if (width < 900) scale *= 1.12;
  else if (width < 1400) scale *= 1.04;
  if (height < 840) scale *= 1.05;
  if (height < 700) scale *= 1.08;
  const target = new THREE.Vector3(...view.target);
  const position = new THREE.Vector3(...view.position).sub(target).multiplyScalar(scale).add(target);
  return { position: position.toArray(), target: target.toArray() };
}

function applyView(viewKey, options = {}) {
  const view = VIEWS[viewKey];
  if (!view) return;
  state.activeView = viewKey;
  document.querySelectorAll(".view-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === viewKey);
  });
  setCinematic(false);
  seaAllowed = viewKey !== "top";
  if (sea?.root) sea.root.visible = seaAllowed && state.explode < 0.62;
  setSection(Boolean(view.section), { silent: true });
  setExplode(view.explode);
  if (!options.skipFly) {
    const fitted = fitView(view);
    flyTo(fitted.position, fitted.target, 1.45);
  }
}

function focusPart(id) {
  if (!id) return;
  const views = {
    hull: { position: [365, 130, 220], target: [0, 8, 4] },
    flightdeck: { position: [205, 128, 178], target: [-2, 26, 10] },
    elevators: { position: [112, 52, 150], target: [33, 22, 108] },
    island: { position: [126, 64, 32], target: [31, 34, -45] },
    hangar: { position: [228, 92, 246], target: [0, 14, 44] },
    propulsion: { position: [196, 2, 272], target: [0, -16, 40] },
    airwing: { position: [162, 104, 132], target: [0, 28, -40] },
    weapons: { position: [180, 82, 232], target: [8, 26, 118] },
    structure: { position: [218, 104, 204], target: [0, 12, 12] },
  };
  const view = fitView(views[id] ?? views.hull);
  if (id === "hangar" || id === "structure") setSection(true, { silent: true });
  if (id === "propulsion") setExplode(0.92);
  else if (state.explode < 0.24) setExplode(0.38);
  flyTo(view.position, view.target, 1.35);
  const index = PARTS.findIndex((part) => part.id === id) + 1;
  showToast(`镜头定位 / ${String(index).padStart(2, "0")} ${partMap.get(id).name}`);
}

function setExplode(value, options = {}) {
  const normalized = THREE.MathUtils.clamp(Number(value), 0, 1);
  state.targetExplode = normalized;
  const display = Math.round(normalized * 100);
  explodeInput.value = String(display);
  explodeValue.textContent = String(display).padStart(3, "0");
  if (!options.silent) {
    const viewKey = Object.entries(VIEWS).find(([, view]) => Math.abs(view.explode - normalized) < 0.02)?.[0];
    if (viewKey) {
      state.activeView = viewKey;
      document.querySelectorAll(".view-button").forEach((button) => {
        button.classList.toggle("is-active", button.dataset.view === viewKey);
      });
    }
  }
}

function setSection(enabled, options = {}) {
  state.section = Boolean(enabled);
  shipMaterials.forEach((material) => {
    material.clippingPlanes = state.section ? [sectionPlane] : [];
    material.clipShadows = state.section;
    material.needsUpdate = true;
  });
  sectionGuide.visible = state.section;
  const button = document.querySelector('[data-toggle="section"]');
  button.setAttribute("aria-pressed", String(state.section));
  readoutStatus.textContent = state.wireframe ? "WIREFRAME / TOPOLOGY" : state.section ? "SECTION / A—A" : "ORBIT / FREE";
  updateLabels();
  if (!options.silent) showToast(state.section ? "剖面模式开启 / SECTION A—A" : "剖面模式关闭 / FULL HULL");
}

function setWireframe(enabled) {
  state.wireframe = Boolean(enabled);
  shipMaterials.forEach((material) => {
    if (!("wireframe" in material)) return;
    if (material.map && material.transparent) return;
    material.wireframe = state.wireframe;
    material.needsUpdate = true;
  });
  document.querySelector('[data-toggle="wireframe"]').setAttribute("aria-pressed", String(state.wireframe));
  readoutStatus.textContent = state.wireframe ? "WIREFRAME / TOPOLOGY" : state.section ? "SECTION / A—A" : "ORBIT / FREE";
  showToast(state.wireframe ? "线框拓扑开启 / WIREFRAME" : "实体表面恢复 / SOLID");
}

function setLabels(enabled) {
  state.labels = Boolean(enabled);
  document.querySelector('[data-toggle="labels"]').setAttribute("aria-pressed", String(state.labels));
  updateLabels();
}

function setAutoRotate(enabled) {
  state.autoRotate = Boolean(enabled);
  controls.autoRotate = state.autoRotate;
  document.querySelector('[data-toggle="autorotate"]').setAttribute("aria-pressed", String(state.autoRotate));
  showToast(state.autoRotate ? "自动环绕开启 / ORBIT" : "自动环绕关闭 / MANUAL");
}

function resetAll() {
  animator?.stop();
  setCinematic(false);
  state.isolatedId = null;
  Object.values(ship.groups).forEach((group) => {
    group.visible = true;
  });
  setSection(false, { silent: true });
  setWireframe(false);
  setAutoRotate(false);
  setLabels(true);
  state.selectedId = null;
  document.body.classList.remove("has-selection");
  updateAssemblyVisibilityUI();
  updateSelectionHelper();
  renderOverview();
  updateReadout(null);
  applyView("overview");
  showToast("工作台已复位 / SYSTEM RESET");
}

/* ══════════════════════════════════════════════════════════════
   INTERACTION
   ══════════════════════════════════════════════════════════════ */

function setupInteractionEvents() {
  controls.addEventListener("start", () => {
    state.dragging = true;
    stage.classList.add("is-dragging");
    cameraTween = null;
  });
  controls.addEventListener("end", () => {
    state.dragging = false;
    stage.classList.remove("is-dragging");
  });

  renderer.domElement.addEventListener("pointermove", (event) => {
    const rect = renderer.domElement.getBoundingClientRect();
    lastPointer.x = event.clientX;
    lastPointer.y = event.clientY;
    pointerNdc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    hoverDirty = true;
  });

  renderer.domElement.addEventListener("pointerleave", () => {
    hoverDirty = false;
    state.hoveredId = null;
    renderer.domElement.style.cursor = "";
    if (!state.selectedId) readoutName.textContent = "WHOLE SHIP / 整舰";
  });

  renderer.domElement.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    pointerDown = { x: event.clientX, y: event.clientY };
  });

  renderer.domElement.addEventListener("pointerup", (event) => {
    if (event.button !== 0 || !pointerDown) return;
    const distance = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
    pointerDown = null;
    if (distance > 5) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const id = pickPart(ndc);
    if (id) selectPart(id);
    else clearSelection();
  });

  explodeInput.addEventListener("input", (event) => {
    setExplode(Number(event.target.value) / 100, { silent: true });
  });

  document.querySelectorAll("[data-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.toggle === "section") setSection(!state.section);
      else if (button.dataset.toggle === "wireframe") setWireframe(!state.wireframe);
      else if (button.dataset.toggle === "labels") setLabels(!state.labels);
      else if (button.dataset.toggle === "autorotate") setAutoRotate(!state.autoRotate);
    });
  });

  document.getElementById("reset-view").addEventListener("click", resetAll);
  document.getElementById("show-all").addEventListener("click", showAllGroups);
  isolateButton.addEventListener("click", isolateSelected);
  document.getElementById("detail-close").addEventListener("click", clearSelection);

  document.querySelectorAll(".view-button").forEach((button) => {
    button.addEventListener("click", () => applyView(button.dataset.view));
  });

  detailBody.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    if (action === "focus" && state.selectedId) focusPart(state.selectedId);
    if (action === "isolate" && state.selectedId) isolateSelected();
  });

  const helpButton = document.getElementById("help-button");
  const helpClose = document.getElementById("help-close");
  const openHelp = () => {
    helpModal.classList.add("is-open");
    helpModal.setAttribute("aria-hidden", "false");
    controls.enabled = false;
  };
  const closeHelp = () => {
    helpModal.classList.remove("is-open");
    helpModal.setAttribute("aria-hidden", "true");
    controls.enabled = true;
  };
  helpButton.addEventListener("click", openHelp);
  helpClose.addEventListener("click", closeHelp);
  helpModal.querySelector("[data-close-help]").addEventListener("click", closeHelp);

  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    const key = event.key.toLowerCase();
    if (key === "escape") {
      if (helpModal.classList.contains("is-open")) closeHelp();
      else clearSelection();
      return;
    }
    if (helpModal.classList.contains("is-open")) return;
    if (key === "x") setSection(!state.section);
    else if (key === "w") setWireframe(!state.wireframe);
    else if (key === "l") setLabels(!state.labels);
    else if (key === "a") setAutoRotate(!state.autoRotate);
    else if (key === "r") resetAll();
    else if (key === "?" || key === "/") openHelp();
    else if (/^[1-9]$/.test(key)) {
      const viewKeys = Object.keys(VIEWS);
      const viewKey = viewKeys[Number(key) - 1];
      if (viewKey) applyView(viewKey);
    }
  });

  window.addEventListener("resize", onResize);
  updateSceneShift();
}

function pickPart(ndc) {
  if (!ship) return null;
  raycaster = raycaster || new THREE.Raycaster();
  raycaster.setFromCamera(ndc, camera);
  const intersections = raycaster.intersectObject(ship.root, true);
  for (const intersection of intersections) {
    let object = intersection.object;
    let partId = null;
    while (object && object !== ship.root) {
      if (object.userData?.partId) {
        partId = object.userData.partId;
        break;
      }
      object = object.parent;
    }
    if (!partId) continue;
    if (!ship.groups[partId]?.visible) continue;
    return partId;
  }
  return null;
}

function updateHover() {
  if (!hoverDirty || state.dragging || !pointerNdc) return;
  hoverDirty = false;
  const now = performance.now();
  if (now - lastHoverPick < 40) return;
  lastHoverPick = now;
  const id = pickPart(pointerNdc);
  state.hoveredId = id;
  renderer.domElement.style.cursor = id ? "pointer" : "";
  if (id && !state.selectedId) {
    const part = partMap.get(id);
    readoutName.textContent = `${part.name} / ${part.en}`;
  } else if (!id && !state.selectedId) {
    readoutName.textContent = "WHOLE SHIP / 整舰";
  }
}

function updateSceneShift() {
  const width = window.innerWidth;
  let shift = 0;
  if (width > 840 && width <= 1220) {
    const leftEdge = width <= 1020 ? 244 : 278;
    const rightEdge = width - 14;
    shift = Math.max(0, Math.min(170, (leftEdge + rightEdge) / 2 - width / 2));
  }
  stage.style.setProperty("--scene-shift", `${Math.round(shift)}px`);
}

function onResize() {
  if (!renderer) return;
  const width = window.innerWidth;
  const height = window.innerHeight;
  updateSceneShift();
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height);
  composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  composer.setSize(width, height);
  labelRenderer.setSize(width, height);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2200);
}

/* ══════════════════════════════════════════════════════════════
   ANIMATION / BOOT
   ══════════════════════════════════════════════════════════════ */

function updateExplode(dt) {
  const smoothing = 1 - Math.exp(-dt * 7.5);
  state.explode += (state.targetExplode - state.explode) * smoothing;
  if (Math.abs(state.targetExplode - state.explode) < 0.0003) state.explode = state.targetExplode;

  const t = state.explode;
  PARTS.forEach((part) => {
    const group = ship?.groups?.[part.id];
    if (!group) return;
    const delay = part.delay ?? 0;
    const local = delay >= 0.999 ? 0 : THREE.MathUtils.clamp((t - delay) / (1 - delay), 0, 1);
    const eased = local * local * (3 - 2 * local);
    group.position.set(part.direction[0] * eased, part.direction[1] * eased, part.direction[2] * eased);
  });
  if (sea?.root) sea.root.visible = seaAllowed && t < 0.62;
  if (effects?.setVisible) effects.setVisible(t < 0.62);

  explodeValue.textContent = String(Math.round(t * 100)).padStart(3, "0");
  updateLabels();
  if (state.selectedId) updateSelectionHelper();
}

const labelProjection = new THREE.Vector3();

function cullLabels() {
  if (!state.labelsReady) return;
  const width = window.innerWidth;
  const height = window.innerHeight;
  const safeTop = 118;
  const safeBottom = height - 162;
  const apply = (entry) => {
    const object = entry.object ?? entry;
    const element = entry.element ?? object.element;
    object.getWorldPosition(labelProjection);
    labelProjection.project(camera);
    const sx = (labelProjection.x * 0.5 + 0.5) * width;
    const sy = (-labelProjection.y * 0.5 + 0.5) * height;
    const narrow = width < 700;
    const edge = narrow ? 142 : 18;
    const offscreen = labelProjection.z < -1 || labelProjection.z > 1 || sx < edge || sx > width - edge || sy < safeTop || sy > safeBottom;
    element.classList.toggle("is-offscreen", offscreen);
  };
  partLabels.forEach(apply);
  guideLabels.forEach(apply);
}

function updateReadoutCoordinates() {
  const p = camera.position;
  readoutCoords.textContent = `X ${p.x.toFixed(1)} · Y ${p.y.toFixed(1)} · Z ${p.z.toFixed(1)}`;
}

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - lastFrameTime) / 1000, 0.05);
  lastFrameTime = now;
  simulate(dt);
  renderFrame();
}

function simulate(dt) {
  updateCameraTween(performance.now());
  updateExplode(dt);
  animator?.update(dt);
  updateHover();
  controls.update();
  updateReadoutCoordinates();
  cullLabels();
}

function renderFrame() {
  composer.render();
  labelRenderer.render(scene, camera);
}

function setBootProgress(value, label) {
  const v = Math.round(THREE.MathUtils.clamp(value, 0, 100));
  bootBar.style.width = `${v}%`;
  bootPercent.textContent = String(v).padStart(3, "0");
  if (label) bootStatus.textContent = label;
}

function setupUIInitialState() {
  setExplode(VIEWS.overview.explode, { silent: true });
  updateAssemblyVisibilityUI();
  updateLabels();
  renderOverview();
  updateReadout(null);
  readoutStatus.textContent = "PERSP / FREE";
}

function boot() {
  try {
    initRenderer();
    setBootProgress(18, "正在初始化结构网格");
    buildShipScene();
    setBootProgress(50, "正在装配飞行甲板与动力系统");
    buildAssemblyTree();
    setBootProgress(72, "正在挂载空间标注");
    setupUIInitialState();
    setBootProgress(88, "正在校准剖面与镜头");

    requestAnimationFrame(animate);

    let fake = 88;
    const timer = window.setInterval(() => {
      fake = Math.min(97, fake + Math.ceil(Math.random() * 2));
      setBootProgress(fake, "正在校准剖面与镜头");
    }, 110);

    window.setTimeout(() => {
      window.clearInterval(timer);
      setBootProgress(100, "模型就绪 / STRUCTURE ONLINE");
      window.setTimeout(() => {
        bootScreen.classList.add("is-done");
        state.labelsReady = true;
        updateLabels();
        state.explode = 0;
        setExplode(VIEWS.overview.explode, { silent: true });
        const introView = fitView(VIEWS.overview);
        flyTo(introView.position, introView.target, 2.2);
        state.booted = true;
      }, 420);
    }, 1050);
  } catch (error) {
    console.error(error);
    setBootProgress(100, "初始化异常 / 请检查控制台");
    bootStatus.style.color = "#ff8f80";
  }
}

boot();