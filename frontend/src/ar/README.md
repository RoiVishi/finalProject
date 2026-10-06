# AR mode (FR-AR) — scaffold

Skeleton for the augmented-reality view specified in Requirements Document v1.3
§4.10 / SRS v1.2 §3.9, Jira epic **KAN-105**.

**Target hardware (confirmed 7.9.2026): Meta Quest 3S.** 6DoF inside-out
tracking, colour passthrough, and WebXR `immersive-ar` with hit-test in the Meta
Browser — so the whole epic stays inside this React/three.js codebase and no
Unity project is needed. Two things follow from the device and are already
reflected in the code: input is a tracked controller ray rather than a touch,
and all in-session UI is drawn in the scene because `dom-overlay` does not exist
in an immersive session on Quest.

It is deliberately **additive**: nothing in `DigitalTwin.jsx`, `App.jsx` or the
backend depends on this folder. Delete `src/ar/` and the 2D Twin still builds
and runs — the only edits made outside this folder are three `export` keywords,
one import of the shared colour scale, and one lazily-loaded button.

## Files

| File | Requirement | What it does |
|---|---|---|
| `riskBands.js` | AR-4, PRED-11 | The only definition of the risk bands, the colour scale and the Hebrew labels. `DigitalTwin.jsx` imports `RISK_COLORS` from here, so changing one value changes both views — which is exactly the AR-4 acceptance criterion. |
| `arSupport.js` | AR-1 | `detectArSupport()` / `useArSupport()` / `requestArSession()`. Never throws; every failure returns a reason that maps to one line of Hebrew. |
| `ARModel.jsx` | AR-2, AR-3, AR-4 | Builds the schematic model from the **same** `zonesFor(spec)` the Twin uses. Completed zones opaque, planned zones translucent, derived from `zone.status`. |
| `ARScene.jsx` | AR-2, AR-5 | The WebXR session: hit test, reticle, placement, controller-ray picking with head-gaze fallback. |
| `ARPanel.jsx` | AR-4, AR-5 | In-scene zone card, legend and status line, drawn to a 2D canvas and used as a texture. |
| `ARView.jsx` | AR-1, AR-7 | Pre-session screen and error boundary. |

## Why no `@react-three/xr`

**NFR-AR-3** asks the AR module not to grow the initial bundle, and right now the
AR chunk pulls in nothing the Twin does not already load. The original second
reason — unknown hardware — is resolved; now that the target is a Quest 3S,
adopting `@react-three/xr` is a reasonable thing to reconsider, since its
controller and hand-tracking components would replace roughly the input half of
`ARScene.jsx`. Weigh that against the bundle cost before switching.

## Why the panels are canvas textures, not HTML or `<Text>`

Two traps avoided:

- **HTML.** `dom-overlay` is the natural answer on a phone, and it was the first
  implementation here. It does not exist inside an immersive session on Quest —
  the layer simply never appears. In-scene panels work on both the headset and
  the tablet, so there is one code path.
- **drei's `<Text>`.** It renders through troika, whose bidi handling for Hebrew
  is not something to discover is wrong on demo day. Drawing to a 2D canvas
  hands the shaping to the browser's own text engine (`ctx.direction = 'rtl'`),
  which gets Hebrew right for free.

react-three-fiber v8 already switches its render loop to `setAnimationLoop` on
`sessionstart` and passes the `XRFrame` into `useFrame`, which is the whole of
the integration this needs.

## What is real and what is still a stub

**Working:** capability detection, session start/end, surface hit test with a
reticle, tap-to-place, per-zone colour and opacity from live `zonesFor()` data,
tap-to-select wired into the same `selected` state as the sidebar, legend,
error containment.

**Stub / next:**

- **Exit control.** Leaving the session is the browser's job — the Meta Browser
  and mobile Chrome both provide one, and the `end` event brings us back to the
  Twin. If the demo wants an in-scene exit button, it has to be built as
  geometry like the panels.
- **Hit test from the controller.** The hit-test source is currently requested
  against `viewer` space, so placement follows where you look. On Quest,
  requesting it against the controller's `targetRaySpace` would be more natural.
  Small change, worth doing after the first run on device.
- **Anchors.** The model is pinned to a `Matrix4` captured from the hit test in
  the `local-floor` reference space. That is stable enough to walk around, but
  it is not an `XRAnchor`. AR-2's acceptance criterion (return to within 5 cm
  and 5° after a full walk-around) has to be **measured**, and if the pose
  drifts, switch to `XRFrame.createAnchor()` — already requested as an optional
  feature in `arSupport.js`.
- **Scale.** `scale` defaults to `0.02`, chosen so a 5-floor spec sits nicely on
  a desk. AR-2 wants it to be configuration, not a default buried in a prop —
  move it next to the risk bands once AR-0 fixes the demo scale.
- **SHAP explanation.** `ZonePanel` shows status, risk and tasks. The
  explanation sentence lands there when `/explain` is wired in (S16). Until then
  it shows no explanation rather than a placeholder — NFR-USE-1 forbids a bare
  score, so an empty space is the correct behaviour, not a missing feature.
- **Role scoping.** AR-5 requires that a subcontractor sees risk detail for own
  tasks only. The panel currently renders whatever the demo `zonesFor()`
  produces; the filter arrives with the real API.
- **Room setup on Quest.** The 3S has no depth sensor, so `hit-test` leans on
  the room mesh captured by the headset's own space setup. Run Quest's room scan
  in the demo space before the session, or the reticle may never find a
  surface. This is a setup step, not a code fix — put it in the demo script.

## Running it

WebXR needs a secure context. `vite dev` on `localhost` is fine on the machine
itself; to test on the department tablet, serve over HTTPS or use a tunnel, then
open the app and press **צפייה ב-AR**. The button only appears when
`navigator.xr.isSessionSupported('immersive-ar')` resolves true, so on a laptop
it is simply not there — that is AR-1 behaving correctly, not a bug.

## Bundle check (NFR-AR-3)

Measured with an esbuild code-split build of `src/main.jsx` (2.9.2026):

```
main.js               27.2 kB   entry
ARView-*.js            8.7 kB   loaded only when "צפייה ב-AR" is pressed
ARScene-*.js           8.7 kB   loaded only after that
```

No AR scene code and no AR UI string appears in the entry chunk. Two small
pieces *are* statically imported and therefore do sit in the entry bundle, on
purpose:

- `riskBands.js` (~1.9 kB) — the Twin itself needs the colour scale.
- `arSupport.js` (~2.5 kB) — capability detection has to run before the button
  can decide whether to exist.

So the honest reading of NFR-AR-3 is "the AR *renderer* adds nothing to the
initial bundle", not "zero bytes". Worth stating that way in the NFR evidence
table rather than claiming a clean zero.

Note that `vite build` will not run inside a Linux shell against a
`node_modules` installed on macOS — rollup's native binary is
platform-specific. Build on the Mac, or reinstall dependencies for the target
platform.
