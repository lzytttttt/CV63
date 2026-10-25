# USS Kitty Hawk (CV-63) / V2.1 — Three.js 参数化概念模型

基于用户上传的 `js.txt` 修正，不是精确的船厂 CAD、历史时期复原图或内部舱室工程图。保留接口 `createCV63KittyHawk()`。

## 文件

- `kitty_hawk_cv63_v21.js` — 正式 ESM 源码，依赖 `three`；导出 `createCV63KittyHawk`、`createCV63KittyHawkModel`、`CV63_PARAMS`、`createLoftHullGeometry`、`exportCV63ToGLB`。
- `cv63_parameters.json` — 与源码命名对应的可编辑参数。默认值适用于当前概念方案。
- `kitty_hawk_v21_preview.html` — 可旋转、切换视角、切换线框、选定升降机下降、爆炸分层、导出 GLB 的独立预览（需要联网加载 Three.js CDN）。
- `cv63_v21_geometry_check.png` — 静态甲板拓扑校验图。
- `cv63_v21_isometric_check.png` — 独立 Python 静态几何示意，**不是浏览器渲染截图**，且仅示意部分舰岛造型。
- `validate_cv63.py` / `validation_results.json` — 几何与尺寸测试。

## 已修复

1. 不再把整个甲板图形 `maxX-minX` 误判为“同一横截面最大宽”。新函数 `maxDeckSectionWidth()` 计算同一 Plan-Y 位置的边界交点，得到缩放系数约 `0.9139994`，最终横截面最大宽度 `76.8m`。
2. 使用同一个 `landingAngleDeg` 参数推导斜角着舰中心线，不再手动硬编码着舰端点。几何测试确认中心线倾角为 `11.2°`。
3. 船体从 `ExtrudeGeometry` 垂直挤出改为 `SplineCurve` 插值的多站位横剖面 `BufferGeometry` 蒙皮。**这仍是简化船体形体，不是精确型线。**
4. 舷台支撑不再采用巨大的实心挤出层，改为边缘轮廓与疏散的结构斜撑。升降机采用独立平台，默认顶面齐平，均可控制 `0–8m` 下降。
5. 左舷尾部升降机设有概念性的上舷侧开口，减少其下降运动时的舰体侧板遮挡；仍需生产级布尔几何与碰撞体积校核。
6. 拆分 `hull`、`deck`、`supports`、`elevators`、`island` 和 `hangar` 组件，提供显隐 / 线框 / 爆炸拆解 API。
7. CanvasTexture 的背景噪声用固定种子的伪随机数生成，使重复导出保持一致。

## 在 Three.js 项目里调用

```js
import { createCV63KittyHawkModel } from './kitty_hawk_cv63_v21.js';

const { group, parts, controllers, metrics } = createCV63KittyHawkModel();
scene.add(group);

controllers.setElevatorDrop('Elevator_2_Stbd_Mid', 4.0);
controllers.setExplode(0.45); // 0 - 1
controllers.setWireframe(true);
controllers.setVisible('hangar', true);
controllers.setDeckMarkingsVisible(false);

console.log(metrics.maxSectionWidth); // ~76.8
```

兼容旧调用：

```js
import { createCV63KittyHawk } from './kitty_hawk_cv63_v21.js';
scene.add(createCV63KittyHawk());
```

加载 JSON 参数（适用于 Vite/现代浏览器，改为 fetch 时注意需要 HTTP 服务）：

```js
const config = await fetch('./cv63_parameters.json').then(r => r.json());
const model = createCV63KittyHawkModel(config);
```

## 预览

- 预览 HTML 把模型源码内联，避免浏览器 `file://` 下本地 JS 模块跨源导入限制。
- 浏览器仍须联网访问 `cdn.jsdelivr.net` 提供的 Three.js `0.160.1` 和 OrbitControls。
- 如果本地直接双击页面不能加载 CDN，可在当前文件夹执行 `python -m http.server 8080`，访问 `http://localhost:8080/kitty_hawk_v21_preview.html`。

## 关键控制参数

`cv63_parameters.json` 的 `dimensions.hullLength`、`dimensions.hullBeam`、`dimensions.draft`、`dimensions.deckMaxSectionWidth` 分别控制纵向缩放、船体站位横向缩放、舰底深度比例和甲板最大横截面宽度。`deck.landingAngleDeg` 控制着舰中心线倾角。改变尺寸不意味着自动维持全部现实结构约束，请重新运行验证。

## 自动校验结果

- Node 模块源代码及 HTML 内联模块 `--check` 通过。
- `validate_cv63.py`: 甲板多边形有效；甲板最大横截面 76.8m；着舰中轴线 11.2°；四部升降机与主甲板平面投影重叠率约 0%、0%、0.98%、0%；四条弹射轨道落在甲板内。
- **本环境无法从 CDN 下载 Three.js，未能执行真实浏览器 WebGL 渲染测试。** HTML 是可运行预览的源码，但不能把它视为已经完成的浏览器运行验收。

## 已知限制

- 舰岛、反舰岛舷台、机库、雷达、甲板标记仍是视觉示意，不能作精确历史布局依据。
- 斜角着舰区域与左舷升降机的可动平台附近在部分状态下仍可能发生局部交叠，需工程级布尔开孔及 swept-volume 碰撞测试。
- 导出 GLB 功能依赖成功载入 Three.js；实际渲染/导出文件请在用户项目或本地浏览器中检验。
- 不包含舰船动力舱真实设备布局。
