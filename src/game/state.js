/**
 * 推演初始状态。纯数据，无 DOM / three.js 依赖。
 */

import {
  AIRCRAFT_TYPES,
  DECK_SPOTS,
  DEFENSE,
  HANGAR_BAYS,
  MOUNTS,
  ROSTER,
  SCENARIO_DURATION,
  SCENARIO_NAME,
  SYSTEMS,
  DECK_TIMING,
  GAME_VERSION,
  CAT,
} from "./constants.js";
import { createRng } from "./rng.js";

let messageSerial = 0;
let fxSerial = 0;

export function nextMessageId() {
  messageSerial += 1;
  return `MSG-${messageSerial}`;
}

export function pushMessage(state, entry) {
  const message = {
    id: nextMessageId(),
    t: state.time,
    channel: entry.channel ?? "CIC",
    tone: entry.tone ?? "info",
    text: entry.text ?? "",
    trackId: entry.trackId ?? null,
    aircraftId: entry.aircraftId ?? null,
    sticky: Boolean(entry.sticky),
    read: false,
  };
  state.messages.push(message);
  if (state.messages.length > 160) state.messages.splice(0, state.messages.length - 160);
  state.unread += 1;
  return message;
}

export function pushFx(state, fx) {
  fxSerial += 1;
  state.fxQueue.push({ id: fxSerial, t: state.time, ...fx });
  if (state.fxQueue.length > 80) state.fxQueue.splice(0, state.fxQueue.length - 80);
}

function createAircraft(state, entry) {
  const type = AIRCRAFT_TYPES[entry.type];
  const aircraft = {
    id: entry.id,
    type: entry.type,
    callsign: entry.callsign,
    role: type.role,
    typeLabel: type.label,
    short: type.short,
    state: "ready",
    stateT: 0,
    stateDur: 0,
    spotId: null,
    bayId: null,
    launchCat: null,
    launchCrew: null,
    serviceCrew: null,
    mission: null,
    missionT: 0,
    targetContactId: null,
    fuel: type.endurance,
    endurance: type.endurance,
    harpoons: type.harpoons,
    health: 100,
    queuedMission: null,
    returnReason: null,
    combat: null,
    visualTargetId: null,
    flightPos: { x: 0, y: 0 },
    altitude: 0,
    station: null,
    orbitAngle: 0,
    launchedAt: null,
    recoveredAt: null,
    sorties: 0,
    kills: 0,
    vis: { visible: true, x: 0, y: state.own.pos.y, z: 0, yaw: 0, pitch: 0, gear: 1, burner: 0, folded: 0, phase: "ready" },
    lostReason: null,
    rescueMarker: null,
  };
  aircraft.capPk = type.capPk;

  if (entry.spot) {
    const spot = state.spots.find((item) => item.id === entry.spot);
    if (spot) {
      spot.aircraftId = aircraft.id;
      aircraft.spotId = spot.id;
      aircraft.vis.x = spot.x;
      aircraft.vis.z = spot.z;
      aircraft.vis.y = 0;
      aircraft.vis.yaw = spot.yaw;
      aircraft.vis.folded = type.role === "aew" || type.role === "ew" ? 0 : 1;
    }
  } else if (entry.hangar) {
    const bay = state.hangarBays.find((item) => item.id === entry.hangar);
    if (bay) {
      bay.aircraftId = aircraft.id;
      aircraft.bayId = bay.id;
      aircraft.state = "hangar";
      aircraft.vis.visible = false;
      aircraft.vis.folded = 1;
    }
  }
  return aircraft;
}

export function createInitialState(options = {}) {
  messageSerial = 0;
  fxSerial = 0;
  const seed = options.seed ?? 0x1c63;
  const state = {
    version: GAME_VERSION,
    scenarioName: SCENARIO_NAME,
    duration: SCENARIO_DURATION,
    seed,
    rng: createRng(seed),
    time: 0,
    tick: 0,
    phase: "briefing", // briefing | running | won | lost
    paused: false,
    speed: 1,
    difficulty: options.difficulty ?? "standard",
    own: {
      pos: { x: 0, y: 0 },
      heading: 340,
      speed: 0.0093,
      hull: DEFENSE.hullMax,
      maxHull: DEFENSE.hullMax,
    },
    emcon: "active",
    roe: "tight",
    jam: false,
    autoDefense: true,
    autoSam: false,
    chaff: DEFENSE.chaffLoads,
    chaffCooldown: 0,
    aircraft: [],
    spots: DECK_SPOTS.map((spot) => ({ ...spot, aircraftId: null })),
    hangarBays: HANGAR_BAYS.map((bay) => ({ ...bay, aircraftId: null })),
    cats: Object.fromEntries(
      Object.keys(CAT).map((id) => [id, { id, state: "idle", aircraftId: null, cooldown: 0, online: true }]),
    ),
    elevators: {
      E1: { id: "E1", state: "idle", aircraftId: null, progress: 0, direction: 0, online: true },
      E2: { id: "E2", state: "idle", aircraftId: null, progress: 0, direction: 0, online: true },
      E3: { id: "E3", state: "idle", aircraftId: null, progress: 0, direction: 0, online: true },
      E4: { id: "E4", state: "idle", aircraftId: null, progress: 0, direction: 0, online: true },
    },
    launchCrews: Array.from({ length: DECK_TIMING.launchCrews }, (_, index) => ({
      id: `L${index + 1}`,
      aircraftId: null,
    })),
    serviceCrews: Array.from({ length: DECK_TIMING.serviceCrews }, (_, index) => ({
      id: `S${index + 1}`,
      aircraftId: null,
    })),
    recovery: { active: null, queue: [] },
    contacts: [],
    tracks: [],
    engagements: [],
    attackMissiles: [],
    mounts: MOUNTS.map((mount) => ({
      ...mount,
      online: true,
      cooldown: 0,
      assigned: [],
      fired: 0,
      hits: 0,
      lastFireAt: null,
      targetBearing: mount.bearing3d,
    })),
    systems: Object.fromEntries(SYSTEMS.map((system) => [system.id, { ...system, online: true, health: 100 }])),
    incidents: [],
    dcTeams: Array.from({ length: DEFENSE.dcTeams }, (_, index) => ({
      id: `DC-${index + 1}`,
      incidentId: null,
      progress: 0,
    })),
    messages: [],
    unread: 0,
    fxQueue: [],
    capabilities: { radar: true, aew: false, ew: false, jam: false, aewCount: 0, ewCount: 0 },
    scenario: { index: 0, flags: {}, nextContact: 1, nextTrack: 1, salvosFired: 0, intelAt: -999 },
    stats: {
      launched: 0,
      traps: 0,
      hostileAirKilled: 0,
      missilesIntercepted: 0,
      missilesHit: 0,
      aircraftLost: 0,
      neutralEngaged: 0,
      shipsDestroyed: 0,
      chaffUsed: 0,
      harpoonsFired: 0,
      harpoonHits: 0,
      damageTaken: 0,
      fires: 0,
    },
    result: null,
    rescueMarkers: [],
    selected: { trackId: null, aircraftId: null, mountId: null },
    score: 0,
    intelRequests: 0,
    lastEventT: 0,
  };

  ROSTER.forEach((entry) => {
    state.aircraft.push(createAircraft(state, entry));
  });

  pushMessage(state, {
    channel: "SYS",
    tone: "good",
    text: "CIC 作战系统上线 · v1.1 战役模式 / 推演时间 10 分钟",
    sticky: true,
  });

  return state;
}

export function aircraftById(state, id) {
  return state.aircraft.find((aircraft) => aircraft.id === id) ?? null;
}

export function spotById(state, id) {
  return state.spots.find((spot) => spot.id === id) ?? null;
}

export function freeSpot(state) {
  return state.spots.find((spot) => !spot.aircraftId) ?? null;
}

export function freeServiceCrew(state) {
  return state.serviceCrews.find((crew) => !crew.aircraftId) ?? null;
}

export function freeLaunchCrew(state) {
  return state.launchCrews.find((crew) => !crew.aircraftId) ?? null;
}

export function contactById(state, id) {
  return state.contacts.find((contact) => contact.id === id) ?? null;
}

export function trackById(state, id) {
  return state.tracks.find((track) => track.id === id) ?? null;
}

export function trackForContact(state, contactId) {
  return state.tracks.find((track) => track.contactId === contactId && track.status !== "destroyed") ?? null;
}

export function mountById(state, id) {
  return state.mounts.find((mount) => mount.id === id) ?? null;
}

export function airborneAircraft(state, role = null) {
  return state.aircraft.filter(
    (aircraft) =>
      aircraft.state === "airborne" && (role === null || aircraft.role === role) && aircraft.health > 0,
  );
}
