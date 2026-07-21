/**
 * RoomView: immersive 360° panorama of a room (AI-generated with Nano Banana Pro).
 * The panorama is mapped onto an inverted sphere; drag to look around.
 * Includes in-room navigation between floors/wings and an exit button.
 *
 * Panorama files: public/rooms/{roomType}.jpg
 */
import { CameraControls } from '@react-three/drei';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import React, { Suspense, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

const ROOM_LABELS = {
  living: 'סלון',
  bedroom: 'חדר שינה',
  dining: 'פינת אוכל ומטבח',
  office: 'חדר עבודה',
  construction: 'בשלבי בנייה',
};

function PanoSphere({ url, fadeIn = false, onFaded }) {
  const tex = useLoader(THREE.TextureLoader, url);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = useRef();
  const done = useRef(!fadeIn);
  useFrame((_, dt) => {
    if (done.current || !mat.current) return;
    mat.current.opacity = Math.min(1, mat.current.opacity + dt * 2.2);
    if (mat.current.opacity >= 1) {
      done.current = true;
      onFaded?.();
    }
  });
  return (
    <mesh scale={[-1, 1, 1]} renderOrder={fadeIn ? 1 : 0}>
      <sphereGeometry args={[10, 64, 48]} />
      <meshBasicMaterial
        ref={mat}
        map={tex}
        side={THREE.BackSide}
        transparent={fadeIn}
        opacity={fadeIn ? 0 : 1}
        depthWrite={!fadeIn}
      />
    </mesh>
  );
}

/**
 * Crossfade between panoramas: the previous room stays visible while the new
 * one loads (Suspense) and fades in on top — smooth, no black flash.
 */
function PanoCrossfade({ url }) {
  const [layers, setLayers] = useState([{ url, key: 0 }]);
  useEffect(() => {
    setLayers((L) => {
      const top = L[L.length - 1];
      return top.url === url ? L : [...L.slice(-1), { url, key: top.key + 1 }];
    });
  }, [url]);
  const dropOld = () => setLayers((L) => L.slice(-1));
  return layers.map((l, i) => (
    <Suspense key={l.key} fallback={null}>
      <PanoSphere url={l.url} fadeIn={i > 0} onFaded={dropOld} />
    </Suspense>
  ));
}

function useAvailable(url) {
  const [ok, setOk] = useState(null);
  useEffect(() => {
    let live = true;
    setOk(null);
    fetch(url, { headers: { Range: 'bytes=0-1' } })
      .then((r) => {
        const t = r.headers.get('content-type') || '';
        return r.ok && !t.includes('text/html');
      })
      .catch(() => false)
      .then((v) => live && setOk(v));
    return () => {
      live = false;
    };
  }, [url]);
  return ok;
}

const btn = {
  border: '1px solid #c3ccd5', background: 'rgba(255,255,255,0.92)', borderRadius: 8,
  padding: '8px 14px', cursor: 'pointer', fontSize: 14,
};

export default function RoomView({ zone, zones, onNavigate, onExit }) {
  const url = `/rooms/${zone.roomType}.jpg`;
  const available = useAvailable(url);

  // neighbors for in-room navigation
  const sameWing = zones.filter((z) => z.zoneIndex === zone.zoneIndex);
  const idxInWing = sameWing.findIndex((z) => z.id === zone.id);
  const up = sameWing[idxInWing + 1];
  const down = sameWing[idxInWing - 1];
  const across = zones.find((z) => z.floor === zone.floor && z.zoneIndex !== zone.zoneIndex);

  return (
    <div style={{ position: 'relative', height: '100%' }} dir="rtl">
      {available === false ? (
        <div
          style={{
            height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: '#1c2126', color: '#eee', textAlign: 'center', padding: 24,
          }}
        >
          <div>
            <h3>הפנורמה של החדר חסרה</h3>
            <p style={{ color: '#aaa', fontSize: 14 }}>
              הקובץ <code>public{url}</code> לא נמצא. הרץ <code>bash scripts/fetch_models.sh</code> ורענן.
            </p>
          </div>
        </div>
      ) : (
        <Canvas camera={{ position: [0, 0, 0.1], fov: 72 }} dpr={[1, 2]}>
          <PanoCrossfade url={url} />
          <CameraControls
            makeDefault
            minDistance={0.1}
            maxDistance={0.1}
            smoothTime={0.35}
            azimuthRotateSpeed={-0.4}
            polarRotateSpeed={-0.4}
          />
        </Canvas>
      )}

      {/* HUD */}
      <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 8 }}>
        <button style={btn} onClick={onExit}>← יציאה מהחדר</button>
      </div>
      <div
        style={{
          position: 'absolute', top: 12, left: 12, background: 'rgba(0,0,0,0.55)', color: '#fff',
          padding: '8px 14px', borderRadius: 8, fontSize: 14,
        }}
      >
        {zone.label} · {ROOM_LABELS[zone.roomType] ?? zone.roomType}
      </div>
      <div
        style={{
          position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)',
          display: 'flex', gap: 8,
        }}
      >
        {up && <button style={btn} onClick={() => onNavigate(up)}>⬆ קומה למעלה</button>}
        {down && <button style={btn} onClick={() => onNavigate(down)}>⬇ קומה למטה</button>}
        {across && <button style={btn} onClick={() => onNavigate(across)}>⇄ לאגף השני</button>}
      </div>
    </div>
  );
}
