/**
 * Realistic Digital Twin: renders an AI-generated GLB of the actual building
 * (image-to-3D from the real project photo, generated via Higgsfield),
 * auto-fitted to the parametric spec dimensions, with invisible per-zone
 * hitboxes so the risk/status interaction still works.
 *
 * Expects the model at /models/{spec.id}.glb — falls back to a notice if absent.
 */
import { CameraControls, ContactShadows, Sky, useGLTF } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { zonesFor } from './DigitalTwin.jsx';

/** true / false / null (=checking): does the GLB exist and look like binary glTF? */
function useModelAvailable(url) {
  const [ok, setOk] = useState(null);
  useEffect(() => {
    let live = true;
    setOk(null);
    // fetch first 4 bytes and verify the "glTF" magic — a 404 that falls back
    // to index.html would otherwise crash the GLTF loader with a parse error
    fetch(url, { headers: { Range: 'bytes=0-3' } })
      .then(async (r) => {
        if (!r.ok) return false;
        const buf = new Uint8Array(await r.arrayBuffer());
        return String.fromCharCode(...buf.slice(0, 4)) === 'glTF';
      })
      .catch(() => false)
      .then((v) => live && setOk(v));
    return () => {
      live = false;
    };
  }, [url]);
  return ok;
}

const COLORS = { low: '#4caf50', medium: '#ff9800', high: '#f44336', done: '#90a4ae' };

function BuildingModel({ spec }) {
  const { scene } = useGLTF(`/models/${spec.id}.glb`);
  const fitted = useMemo(() => {
    const clone = scene.clone(true);
    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    const targetH = spec.floors * spec.floorHeight;
    const s = targetH / (size.y || 1);
    clone.scale.setScalar(s);
    const box2 = new THREE.Box3().setFromObject(clone);
    const center = box2.getCenter(new THREE.Vector3());
    clone.position.set(-center.x, -box2.min.y, -center.z); // ground at y=0, centered
    clone.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    return clone;
  }, [scene, spec]);
  return <primitive object={fitted} />;
}

/** Transparent interactive zone boxes overlaid on the GLB, from the same spec. */
function ZoneHitboxes({ spec, selected, onSelect }) {
  const zones = useMemo(() => zonesFor(spec), [spec]);
  const [hovered, setHovered] = useState(null);
  const w = (f) => spec.baseWidth * spec.widthFactor(f);
  return zones.map((z) => {
    const active = hovered === z.id || selected?.id === z.id;
    return (
      <mesh
        key={z.id}
        position={[
          (z.zoneIndex === 0 ? -1 : 1) * (w(z.floor) / 4),
          z.floor * spec.floorHeight + spec.floorHeight / 2,
          0,
        ]}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(z);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(z.id);
        }}
        onPointerOut={() => setHovered(null)}
      >
        <boxGeometry args={[w(z.floor) / 2, spec.floorHeight * 0.95, spec.depth * 1.15]} />
        <meshStandardMaterial
          color={COLORS[z.risk]}
          transparent
          opacity={active ? 0.4 : 0.12}
          depthWrite={false}
        />
      </mesh>
    );
  });
}

function MissingModel() {
  return null;
}

class GlbBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <MissingModel /> : this.props.children;
  }
}

/** Smoothly flies the camera toward the selected zone. */
function FlyToZone({ spec, selected, controls }) {
  useEffect(() => {
    if (!controls.current) return;
    const h = spec.floors * spec.floorHeight;
    if (!selected) {
      controls.current.setLookAt(h * 0.9, h * 0.7, h * 1.1, 0, h / 2, 0, true);
      return;
    }
    const w = spec.baseWidth * spec.widthFactor(selected.floor);
    const x = (selected.zoneIndex === 0 ? -1 : 1) * (w / 4);
    const y = selected.floor * spec.floorHeight + spec.floorHeight / 2;
    const side = selected.zoneIndex === 0 ? -1 : 1;
    controls.current.setLookAt(
      x + side * spec.baseWidth * 0.55,
      y + spec.floorHeight * 1.4,
      spec.depth * 2.4,
      x, y, 0,
      true, // animated transition
    );
  }, [selected, spec, controls]);
  return null;
}

export default function RealisticTwin({ spec, selected, onSelect }) {
  const h = spec.floors * spec.floorHeight;
  const modelUrl = `/models/${spec.id}.glb`;
  const available = useModelAvailable(modelUrl);
  const controls = useRef();

  if (available === false) {
    return (
      <div
        dir="rtl"
        style={{
          height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: '#eef2f5', padding: 24, textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: 460, background: '#fff', border: '1px solid #dde4ea', borderRadius: 12, padding: 20 }}>
          <h3 style={{ marginTop: 0 }}>קובץ המודל התלת־ממדי חסר</h3>
          <p style={{ color: '#555', fontSize: 14 }}>
            המבט הריאליסטי טוען את <code>public{modelUrl}</code>, אך הקובץ לא נמצא.
            הורד אותו פעם אחת:
          </p>
          <pre
            style={{
              direction: 'ltr', textAlign: 'left', background: '#f6f8fa', padding: 10,
              borderRadius: 8, fontSize: 13, overflowX: 'auto',
            }}
          >
            cd frontend{'\n'}bash scripts/fetch_models.sh
          </pre>
          <p style={{ color: '#888', fontSize: 12 }}>ואז רענן את הדף.</p>
        </div>
      </div>
    );
  }
  if (available === null) return null; // still checking

  return (
    <Canvas
      shadows
      camera={{ position: [h * 0.9, h * 0.7, h * 1.1], fov: 45 }}
      dpr={[1, 2]}
      gl={{ antialias: true }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.15;
      }}
    >
      <Sky sunPosition={[80, 60, 20]} turbidity={6} />
      <hemisphereLight args={['#cfe4ff', '#8c7b6a', 0.55]} />
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[15, 25, 12]}
        intensity={1.25}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0002}
      />
      <Suspense fallback={null}>
        <GlbBoundary>
          <BuildingModel spec={spec} />
        </GlbBoundary>
      </Suspense>
      <ZoneHitboxes spec={spec} selected={selected} onSelect={onSelect} />
      <ContactShadows position={[0, 0.01, 0]} opacity={0.45} scale={h * 3} blur={2.2} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color="#dfe6ea" />
      </mesh>
      <CameraControls ref={controls} makeDefault smoothTime={0.45} />
      <FlyToZone spec={spec} selected={selected} controls={controls} />
    </Canvas>
  );
}
