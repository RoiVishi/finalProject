/**
 * The AR session itself: hit test, placement, and pointing.
 *
 * Target hardware (confirmed 7.9.2026): Meta Quest 3S — 6DoF, colour
 * passthrough, WebXR `immersive-ar` with hit-test in the Meta Browser. Two
 * consequences shape this file:
 *
 *   1. Input is a tracked controller, not a finger on glass. Selection uses a
 *      ray from the controller's targetRaySpace, with head-gaze as the fallback
 *      so the same code still works on the department tablet (AR-6).
 *   2. `dom-overlay` does not exist inside an immersive session on Quest, so
 *      every piece of UI is an object in the scene — see ARPanel.jsx.
 *
 * Implemented directly against the WebXR Device API. react-three-fiber v8
 * already switches its loop to setAnimationLoop on `sessionstart` and hands the
 * XRFrame to useFrame, which is the whole of the integration this needs.
 *
 * Covers AR-2 (anchored placement) and the pointing half of AR-5.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import ARModel, { zoneBoxes } from './ARModel.jsx';
import { Legend3D, StatusLine3D, ZonePanel3D } from './ARPanel.jsx';

/* ------------------------------------------------------------------ */
/* Reticle: where the model will land                                  */
/* ------------------------------------------------------------------ */

function Reticle({ visible, matrix }) {
  const ref = useRef();
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    g.visible = visible && !!matrix;
    if (matrix) g.matrix.copy(matrix);
  });
  return (
    <group ref={ref} matrixAutoUpdate={false}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.09, 0.11, 32]} />
        <meshBasicMaterial color="#4caf50" transparent opacity={0.9} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
        <circleGeometry args={[0.02, 16]} />
        <meshBasicMaterial color="#4caf50" />
      </mesh>
    </group>
  );
}

/** The controller ray, so the user can see what they are about to select. */
function PointerRay({ rayRef, visible }) {
  const ref = useRef();
  useFrame(() => {
    const g = ref.current;
    const ray = rayRef.current;
    if (!g) return;
    g.visible = !!(visible && ray && ray.mode === 'tracked-pointer');
    if (!g.visible) return;
    g.position.copy(ray.origin);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), ray.dir);
  });
  return (
    <group ref={ref}>
      <mesh position={[0, 0.75, 0]}>
        <cylinderGeometry args={[0.002, 0.002, 1.5, 6]} />
        <meshBasicMaterial color="#4caf50" transparent opacity={0.55} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Session runtime                                                     */
/* ------------------------------------------------------------------ */

function XRRuntime({ session, spec, scale, selected, onSelect, onPlaced, onStatus, status }) {
  const { gl, camera } = useThree();
  const hitSourceRef = useRef(null);
  const modelRef = useRef();
  const rayRef = useRef(null);
  const raycaster = useRef(new THREE.Raycaster());
  const [reticleMatrix, setReticleMatrix] = useState(null);
  const [anchorMatrix, setAnchorMatrix] = useState(null);

  const anchorRef = useRef(null);
  anchorRef.current = anchorMatrix;
  const reticleRef = useRef(null);
  reticleRef.current = reticleMatrix;

  /* --- hand the session to three.js and request a hit-test source --- */
  useEffect(() => {
    if (!session) return undefined;
    let cancelled = false;
    let localSource = null;

    gl.xr.enabled = true;
    gl.xr
      .setSession(session)
      .then(async () => {
        if (cancelled) return;
        onStatus('כוונו אל משטח ולחצו על ההדק כדי למקם את הבניין');
        const viewerSpace = await session.requestReferenceSpace('viewer');
        if (cancelled) return;
        localSource = await session.requestHitTestSource({ space: viewerSpace });
        if (cancelled) {
          localSource?.cancel?.();
          return;
        }
        hitSourceRef.current = localSource;
      })
      .catch((err) => {
        // AR-7: contained. The caller shows one line; the 2D Twin is untouched.
        onStatus(`לא ניתן להתחיל מפגש AR (${err?.name ?? 'שגיאה'})`);
      });

    return () => {
      cancelled = true;
      try {
        hitSourceRef.current?.cancel?.();
      } catch {
        /* the source dies with the session anyway */
      }
      hitSourceRef.current = null;
      localSource = null;
    };
  }, [session, gl, onStatus]);

  /* --- pick along the pointer ray, falling back to head gaze (AR-5) --- */
  const pickZone = useCallback(() => {
    const group = modelRef.current;
    if (!group) return false;

    let origin;
    let dir;
    const ray = rayRef.current;
    if (ray) {
      origin = ray.origin.clone();
      dir = ray.dir.clone();
    } else {
      const xrCam = gl.xr.isPresenting && gl.xr.getCamera ? gl.xr.getCamera() : camera;
      origin = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      xrCam.getWorldPosition(origin);
      xrCam.getWorldQuaternion(quat);
      dir = new THREE.Vector3(0, 0, -1).applyQuaternion(quat).normalize();
    }

    raycaster.current.set(origin, dir);
    const hits = raycaster.current.intersectObject(group, true);
    for (const hit of hits) {
      let obj = hit.object;
      while (obj && !obj.userData?.zoneId) obj = obj.parent;
      if (obj?.userData?.zone) {
        onSelect(obj.userData.zone);
        return true;
      }
    }
    return false;
  }, [gl, camera, onSelect]);

  /* --- trigger: place first, then select (AR-2 then AR-5) --- */
  useEffect(() => {
    if (!session) return undefined;
    const onSelectEvent = () => {
      if (!anchorRef.current) {
        if (reticleRef.current) {
          setAnchorMatrix(reticleRef.current.clone());
          onPlaced(true);
          onStatus('כוונו את הקרן אל אזור ולחצו כדי לפתוח אותו');
        } else {
          onStatus('לא נמצא משטח. הביטו לאט על הרצפה או על השולחן');
        }
        return;
      }
      if (!pickZone()) onStatus('לא נבחר אזור — כוונו את הקרן אל אחת הקומות');
    };
    session.addEventListener('select', onSelectEvent);
    return () => session.removeEventListener('select', onSelectEvent);
  }, [session, pickZone, onPlaced, onStatus]);

  /* --- per-frame: hit test while unplaced, pointer pose always --- */
  useFrame((_state, _delta, frame) => {
    if (!frame) return;
    const refSpace = gl.xr.getReferenceSpace?.();
    if (!refSpace) return;

    // pointer pose (controller preferred, then anything else the device offers)
    let best = null;
    for (const src of session.inputSources ?? []) {
      if (!src.targetRaySpace) continue;
      const pose = frame.getPose(src.targetRaySpace, refSpace);
      if (!pose) continue;
      const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      best = {
        origin: new THREE.Vector3().setFromMatrixPosition(m),
        dir: new THREE.Vector3(0, 0, -1).applyQuaternion(q).normalize(),
        mode: src.targetRayMode,
      };
      if (src.targetRayMode === 'tracked-pointer') break;
    }
    rayRef.current = best;

    if (anchorRef.current || !hitSourceRef.current) return;
    let results;
    try {
      results = frame.getHitTestResults(hitSourceRef.current);
    } catch {
      return;
    }
    if (!results?.length) return;
    const pose = results[0].getPose(refSpace);
    if (!pose) return;
    const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
    setReticleMatrix((prev) => (prev ? prev.clone().copy(m) : m));
  });

  /* --- where the in-scene panels hang, in world space --- */
  const anchorFrame = useMemo(() => {
    if (!anchorMatrix) return null;
    const xAxis = new THREE.Vector3().setFromMatrixColumn(anchorMatrix, 0).normalize();
    const yAxis = new THREE.Vector3().setFromMatrixColumn(anchorMatrix, 1).normalize();
    const toWorld = (local) =>
      new THREE.Vector3(local[0], local[1], local[2]).multiplyScalar(scale).applyMatrix4(anchorMatrix);
    return { xAxis, yAxis, toWorld };
  }, [anchorMatrix, scale]);

  const panelPos = useMemo(() => {
    if (!anchorFrame || !selected) return null;
    const box = zoneBoxes(spec).find((b) => b.zone.id === selected.id);
    if (!box) return null;
    const side = selected.zoneIndex === 0 ? -1 : 1;
    return anchorFrame
      .toWorld(box.position)
      .addScaledVector(anchorFrame.xAxis, side * (spec.baseWidth * scale * 0.7 + 0.22));
  }, [anchorFrame, selected, spec, scale]);

  const legendPos = useMemo(() => {
    if (!anchorFrame) return null;
    const H = spec.floors * spec.floorHeight;
    return anchorFrame.toWorld([0, H, 0]).addScaledVector(anchorFrame.yAxis, 0.14);
  }, [anchorFrame, spec]);

  return (
    <>
      <ambientLight intensity={0.9} />
      <directionalLight position={[3, 6, 2]} intensity={1.1} />

      <Reticle visible={!anchorMatrix} matrix={reticleMatrix} />
      <PointerRay rayRef={rayRef} visible={!!anchorMatrix} />

      <group ref={modelRef}>
        <ARModel
          spec={spec}
          anchorMatrix={anchorMatrix}
          scale={scale}
          selectedId={selected?.id ?? null}
          onSelect={onSelect}
        />
      </group>

      <Legend3D position={legendPos} />
      <ZonePanel3D zone={selected} position={panelPos} />
      <StatusLine3D text={status} />
    </>
  );
}

export default function ARScene(props) {
  return (
    <Canvas
      gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
      camera={{ fov: 55, near: 0.01, far: 40 }}
      style={{ position: 'absolute', inset: 0, background: 'transparent' }}
    >
      <XRRuntime {...props} />
    </Canvas>
  );
}
