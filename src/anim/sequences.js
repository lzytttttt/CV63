/**
 * 动效序列：巡航镜头、弹射起飞、拦阻着舰、升降机转运、拆解演示。
 * 所有序列通过 api 操作场景中的命名节点，不直接依赖 three.js 场景。
 */
import * as THREE from "three";
import { ANGLED_DECK, CATAPULTS, SHIP } from "../model/constants.js";
import { ease, window01 } from "./animator.js";

const DECK_Y = SHIP.deckY;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

const OVERVIEW_CAM = { position: [372, 196, 430], target: [0, 10, 0] };

/* ── 相机路径（巡航） ─────────────────────────────────────── */
const CRUISE_POINTS = [
  V(470, 150, -430),
  V(520, 120, -60),
  V(360, 90, 330),
  V(0, 70, 470),
  V(-420, 120, 330),
  V(-470, 150, -120),
  V(-260, 190, -430),
  V(180, 240, -470),
  V(470, 150, -430),
];
const CRUISE_TARGETS = [
  V(0, 24, -60),
  V(0, 18, 10),
  V(0, 16, 70),
  V(0, 14, 40),
  V(0, 18, 0),
  V(20, 30, -40),
  V(0, 26, -80),
  V(0, 30, -40),
  V(0, 24, -60),
];
const cruisePath = new THREE.CatmullRomCurve3(CRUISE_POINTS);
const cruiseTargetPath = new THREE.CatmullRomCurve3(CRUISE_TARGETS);

/* ── 弹射：沿弹射器轨道推进 ───────────────────────────────── */
function catVector(catId = "cat1") {
  const cat = CATAPULTS.find((item) => item.id === catId) ?? CATAPULTS[0];
  const start = V(cat.start[0], DECK_Y, cat.start[1]);
  const end = V(cat.end[0], DECK_Y, cat.end[1]);
  return { cat, start, end, dir: end.clone().sub(start).normalize(), length: start.distanceTo(end) };
}

/* ── 着舰几何 ─────────────────────────────────────────────── */
function landingFrame() {
  const stern = ANGLED_DECK.centerStern;
  const bow = ANGLED_DECK.centerBow;
  const dir = V(bow[0] - stern[0], 0, bow[1] - stern[1]).normalize();
  const yaw = Math.atan2(-dir.x, -dir.z);
  return { stern: V(stern[0], DECK_Y, stern[1]), dir, yaw, length: Math.hypot(bow[0] - stern[0], bow[1] - stern[1]) };
}

export function createSequences(api) {
  const animator = api.animator;

  const resetCamera = (duration = 1.4) => {
    api.camera.setCinematic(false);
    api.camera.flyTo(OVERVIEW_CAM.position, OVERVIEW_CAM.target, duration);
  };

  /* ═══════════════ 01 巡航 ═══════════════ */
  animator.registerSequence("cruise", {
    label: "巡航镜头",
    hint: "环绕巡航，雷达、螺旋桨与尾流持续运转",
    duration: 26,
    loop: true,
    setup: (seq) => {
      api.camera.setCinematic(true);
      api.effects?.startCruise?.();
      seq.data.startOffset = 0;
    },
    update: (t, dt, progress, seq) => {
      const p = (t / 26) % 1;
      const position = cruisePath.getPointAt(p);
      const target = cruiseTargetPath.getPointAt(p);
      // 轻微手持感
      const wobble = 0.6;
      api.camera.set(
        [position.x + Math.sin(t * 0.7) * wobble, position.y + Math.cos(t * 0.53) * wobble, position.z],
        [target.x, target.y, target.z],
      );
      void progress;
      void seq;
    },
    finish: () => {
      api.effects?.stopCruise?.();
      api.camera.setCinematic(false);
      resetCamera(1.6);
    },
  });

  /* ═══════════════ 02 弹射起飞 ═══════════════ */
  animator.registerSequence("catapult", {
    label: "弹射起飞",
    hint: "CAT 1 弹射器：挡焰板升起、蒸汽喷射、加速离舰",
    duration: 11,
    setup: (seq) => {
      api.camera.setCinematic(true);
      api.camera.flyTo([128, 58, -18], [-6, 24, -112], 1.2);
      const airwing = api.airwing;
      const hero = airwing?.get("hornet-1");
      const { cat, start, dir } = catVector("cat1");
      seq.data.hero = hero?.object ?? null;
      seq.data.start = start;
      seq.data.dir = dir;
      seq.data.cat = cat;
      if (seq.data.hero) {
        seq.data.hero.visible = true;
        seq.data.hero.position.copy(start);
        seq.data.hero.rotation.set(0, Math.atan2(-dir.x, -dir.z), 0);
        seq.data.hero.userData.setGear?.(1);
        seq.data.hero.userData.setBurner?.(0);
      }
      api.effects?.startCatapult?.();
    },
    update: (t, dt, progress, seq) => {
      const hero = seq.data.hero;
      const { dir, cat } = seq.data;
      const from = seq.data.start;
      const length = catVector("cat1").length;
      const jbd = window01(t, 0.1, 1.1, ease.out);
      api.setJbd(cat.id, jbd);

      if (hero) {
        // 加速滑跑
        const run = window01(t, 1.6, 4.2, (x) => x * x);
        if (t < 4.2) {
          hero.position.copy(from).addScaledVector(dir, run * length);
          hero.position.y = DECK_Y + 0.62;
          hero.rotation.set(0, Math.atan2(-dir.x, -dir.z), 0);
        } else {
          // 离舰爬升
          const airT = t - 4.2;
          hero.position.copy(from).addScaledVector(dir, length);
          hero.position.y = DECK_Y + 0.62 + airT * airT * 4.6 + airT * 2.2;
          hero.position.addScaledVector(dir, airT * 52 + airT * airT * 2.4);
          const pitch = Math.min(0.26, airT * 0.42);
          hero.rotation.set(-pitch, Math.atan2(-dir.x, -dir.z), Math.sin(airT * 1.4) * 0.03);
          hero.userData.setGear?.(t > 5.4 ? 0 : 1);
        }
        hero.userData.setBurner?.(t > 1.3 ? 1 : 0);
        if (t > 1.9 && t < 2.15) {
          api.effects?.steamBurst?.(
            [from.x + dir.x * 2, DECK_Y + 1.2, from.z + dir.z * 2],
            { count: 42, spread: 3.2, duration: 1.4 },
          );
        }
        if (t > 3.2 && t < 3.42) {
          api.effects?.steamBurst?.([cat.jbd[0], DECK_Y + 1.4, cat.jbd[1]], {
            count: 26,
            spread: 2.6,
            duration: 1.2,
          });
        }
      }

      // 相机随舰载机轻微前送
      const push = window01(t, 1.6, 6.0, ease.inOut);
      api.camera.set(
        [128 - push * 14, 58 + push * 10, -18 - push * 44],
        [-6 - push * 2, 24 + push * 6, -112 - push * 30],
      );
      void dt;
      void progress;
    },
    finish: (seq) => {
      api.setJbd(seq.data?.cat?.id ?? "cat1", 0);
      const hero = seq.data?.hero;
      if (hero) {
        hero.position.copy(seq.data.start);
        hero.rotation.set(0, Math.atan2(-seq.data.dir.x, -seq.data.dir.z), 0);
        hero.userData.setGear?.(1);
        hero.userData.setBurner?.(0);
      }
      api.effects?.stopCatapult?.();
      resetCamera(1.3);
    },
  });

  /* ═══════════════ 03 拦阻着舰 ═══════════════ */
  animator.registerSequence("recovery", {
    label: "拦阻着舰",
    hint: "斜角甲板进场、触舰、四道拦阻索减速",
    duration: 12,
    setup: (seq) => {
      api.camera.setCinematic(true);
      api.camera.flyTo([118, 52, 236], [0, 24, 138], 1.2);
      const hero = api.airwing?.get("hero-approach")?.object;
      const { stern, dir, yaw } = landingFrame();
      seq.data.hero = hero;
      seq.data.frame = { stern, dir, yaw };
      if (hero) {
        hero.visible = true;
        hero.userData.setGear?.(1);
        hero.userData.setBurner?.(0.2);
        hero.position.copy(stern).addScaledVector(dir, -110).setY(56);
        hero.rotation.set(-0.06, yaw, -0.03);
      }
      api.effects?.startRecovery?.();
    },
    update: (t, dt, progress, seq) => {
      const hero = seq.data.hero;
      if (!hero) return;
      const { stern, dir, yaw } = seq.data.frame;
      const along = (metres) => stern.clone().addScaledVector(dir, metres);

      if (t < 3.4) {
        // 进场：从舰艉后方 110 m 下降到触舰点
        const k = window01(t, 0, 3.4, ease.out);
        const distance = THREE.MathUtils.lerp(-110, 8, k);
        const y = THREE.MathUtils.lerp(56, DECK_Y + 1.5, Math.pow(k, 1.6));
        hero.position.copy(along(distance));
        hero.position.y = y;
        hero.rotation.set(-0.055 + k * 0.02, yaw, -0.04 * (1 - k));
      } else if (t < 7.4) {
        // 触舰 → 拦阻减速
        const k = window01(t, 3.4, 7.0, ease.out);
        const distance = THREE.MathUtils.lerp(8, 66, k);
        hero.position.copy(along(distance));
        hero.position.y = DECK_Y + 1.5;
        const pitch = t < 3.9 ? 0.02 : -0.02;
        hero.rotation.set(pitch, yaw, 0);
        if (t > 3.45 && t < 3.75) {
          api.effects?.steamBurst?.(
            [hero.position.x, DECK_Y + 0.6, hero.position.z],
            { count: 10, spread: 1.2, duration: 0.9, size: 0.55, life: 0.8 },
          );
        }
      } else {
        // 滑行转弯，退出着舰区
        const k = window01(t, 7.4, 11, ease.inOut);
        hero.position.copy(along(66 + k * 10));
        hero.position.x += k * 20;
        hero.position.y = DECK_Y + 1.5;
        hero.rotation.set(0, yaw + k * 0.9, 0);
      }
      hero.userData.setGear?.(1);
      if (t > 10.2) hero.visible = false;

      const zoom = window01(t, 0, 4, ease.out);
      api.camera.set(
        [118 - zoom * 26, 52 - zoom * 6, 236 - zoom * 34],
        [0, 24, 138 - zoom * 26],
      );
      void dt;
      void progress;
    },
    finish: (seq) => {
      const hero = seq.data?.hero;
      if (hero) {
        hero.visible = false;
        hero.position.set(0, 120, 420);
        hero.rotation.set(0, 0, 0);
        hero.userData.setGear?.(1);
      }
      api.effects?.stopRecovery?.();
      resetCamera(1.3);
    },
  });

  /* ═══════════════ 04 升降机转运 ═══════════════ */
  animator.registerSequence("elevator", {
    label: "升降机转运",
    hint: "ELEV 3：舰载机随平台下沉至机库甲板并回升",
    duration: 10,
    setup: (seq) => {
      api.camera.setCinematic(true);
      api.camera.flyTo([128, 52, 150], [33, 20, 111], 1.3);
      api.elevators?.setElevator("E3", 0, { immediate: true });
      seq.data.elevator = "E3";
    },
    update: (t, dt, progress, seq) => {
      const controller = api.elevators;
      if (!controller) return;
      let value = 0;
      if (t < 1.4) value = 0;
      else if (t < 4.4) value = window01(t, 1.4, 4.4, ease.inOut);
      else if (t < 5.6) value = 1;
      else if (t < 8.0) value = 1 - window01(t, 5.6, 8.0, ease.inOut);
      else value = 0;
      controller.setElevator(seq.data.elevator, value);
      const push = window01(t, 0, 2.2, ease.out);
      api.camera.set(
        [128 - push * 14, 52 - push * 2, 150 - push * 12],
        [33, 20 - value * 4, 111],
      );
      void dt;
      void progress;
    },
    finish: (seq) => {
      api.elevators?.setElevator(seq.data?.elevator ?? "E3", 0);
      resetCamera(1.2);
    },
  });

  /* ═══════════════ 05 拆解演示 ═══════════════ */
  animator.registerSequence("explodeTour", {
    label: "拆解演示",
    hint: "沿八个功能区块分层抽离舰体",
    duration: 11,
    setup: (seq) => {
      api.camera.setCinematic(true);
      api.camera.flyTo([430, 230, 500], [0, 10, 0], 1.4);
      seq.data.from = api.getExplode?.() ?? 0.32;
    },
    update: (t, dt, progress, seq) => {
      const k = window01(t, 0.6, 6.0, ease.inOut);
      const back = window01(t, 8.2, 10.6, ease.inOut);
      const value = THREE.MathUtils.lerp(seq.data.from, 1, k) * (1 - back) + seq.data.from * back;
      api.setExplode(value);
      const orbit = t * 0.045;
      api.camera.set(
        [430 * Math.cos(orbit), 230 + Math.sin(t * 0.2) * 12, 500 * Math.sin(orbit)],
        [0, 10 - k * 6, 0],
      );
      void dt;
      void progress;
    },
    finish: (seq) => {
      api.setExplode(seq.data?.from ?? 0.1);
      resetCamera(1.4);
    },
  });

  return { resetCamera };
}
