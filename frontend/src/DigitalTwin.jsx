/**
 * Parametric Digital Twin v4: renders building spec (projects.js) with
 * high-fidelity facade detail and realistic textures (brick arches, punched window
 * grids, ribbon windows with mullions) using AI-generated textures, terraced
 * planter balconies with cascading plants, and detailed furnished interiors.
 */
import { CameraControls, ContactShadows, Html, Sky, useTexture } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import React, { useEffect, useMemo, useRef, useState, Suspense } from 'react';
import * as THREE from 'three';
import { RoomSet } from './furniture.jsx';

const COLORS = { low: '#4caf50', medium: '#ff9800', high: '#f44336', done: '#90a4ae' };
const WINGS = ['מזרח', 'מערב'];
const ROOM_TYPES = ['living', 'bedroom', 'dining', 'office'];

const LEAF = '#2e7d32';
const LEAF_LIGHT = '#66bb6a';

export const DEMO_ZONES = [];

function zoneRisk(f, zi, floors) {
  if (f === 0) return { risk: 'done', prob: null, status: 'הושלם' };
  const r = ['low', 'medium', 'high'][(f * 2 + zi * 3) % 3];
  const status = f < Math.ceil(floors / 3) ? 'בתהליך' : 'טרם החל';
  const prob = r === 'high' ? 0.82 : r === 'medium' ? 0.45 : 0.12;
  return { risk: r, prob, status };
}

export function zonesFor(spec) {
  const out = [];
  for (let f = 0; f < spec.floors; f++) {
    WINGS.forEach((w, zi) => {
      const { risk, prob, status } = zoneRisk(f, zi, spec.floors);
      out.push({
        id: `${spec.id}-f${f}-z${zi}`,
        floor: f,
        zoneIndex: zi,
        label: `קומה ${f + 1} — אגף ${w}`,
        risk,
        prob,
        status,
        roomType: status === 'טרם החל' ? 'construction' : ROOM_TYPES[(f + zi * 2) % ROOM_TYPES.length],
        tasks:
          risk === 'high'
            ? ['עבודות חשמל (חסום: שלד לא הושלם)', 'התקנת צנרת', 'איטום']
            : risk === 'done'
              ? ['נמסר לבדק']
              : ['בנייה', 'טיח', 'ריצוף'],
      });
    });
  }
  return out;
}

const floorY = (spec, f) => f * spec.floorHeight;
const widthAt = (spec, f) => spec.baseWidth * spec.widthFactor(f);
const zoneCenterX = (spec, f, zi) => (zi === 0 ? -1 : 1) * (widthAt(spec, f) / 4);

/** Row of brick arches along a facade edge — the Penda Arcades signature. */
function ArchRow({ w, fh, y, z, color, map }) {
  const n = Math.max(3, Math.round(w / 1.5));
  const aw = w / n;
  const r = aw * 0.38;
  const jambH = fh - 0.2;
  return (
    <group position={[0, y, z]}>
      {Array.from({ length: n + 1 }, (_, i) => (
        <mesh key={`j${i}`} position={[-w / 2 + aw * i, 0, 0]} castShadow>
          <boxGeometry args={[0.16, jambH, 0.16]} />
          <meshStandardMaterial color={color} map={map} roughness={0.8} />
        </mesh>
      ))}
      {Array.from({ length: n }, (_, i) => (
        <mesh key={`a${i}`} position={[-w / 2 + aw * (i + 0.5), jambH / 2 - r, 0]}>
          <torusGeometry args={[r, 0.08, 10, 16, Math.PI]} />
          <meshStandardMaterial color={color} map={map} roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

/** Punched-window grid with recessed glass frames (Podun-style). */
function WindowGrid({ w, fh, y, z, windowColor }) {
  const n = Math.max(2, Math.round(w / 1.7));
  const ww = (w / n) * 0.52;
  const wh = fh * 0.42;
  return (
    <group position={[0, y + fh * 0.06, z]}>
      {Array.from({ length: n }, (_, i) => {
        const x = -w / 2 + (w / n) * (i + 0.5);
        return (
          <group key={i} position={[x, 0, 0]}>
            {/* Outer frame */}
            <mesh castShadow>
              <boxGeometry args={[ww + 0.08, wh + 0.08, 0.12]} />
              <meshStandardMaterial color="#2d3748" roughness={0.7} />
            </mesh>
            {/* Recessed glass pane */}
            <mesh position={[0, 0, -0.02]}>
              <boxGeometry args={[ww, wh, 0.02]} />
              <meshPhysicalMaterial
                color={windowColor}
                roughness={0.05}
                metalness={0.1}
                transparent
                opacity={0.35}
                transmission={0.9}
                thickness={0.05}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/** Ribbon window band with vertical mullions (Ba'al Haakeda-style). */
function RibbonWindows({ w, fh, y, z, windowColor }) {
  const n = Math.max(4, Math.round(w / 0.9));
  return (
    <group position={[0, y + fh * 0.08, z]}>
      {/* Outer frame borders */}
      <mesh castShadow>
        <boxGeometry args={[w - 0.2, fh * 0.44, 0.08]} />
        <meshStandardMaterial color="#1a202c" roughness={0.6} />
      </mesh>
      {/* Continuous glass recess */}
      <mesh position={[0, 0, 0.01]}>
        <boxGeometry args={[w - 0.24, fh * 0.40, 0.04]} />
        <meshPhysicalMaterial
          color={windowColor}
          roughness={0.05}
          metalness={0.1}
          transparent
          opacity={0.35}
          transmission={0.9}
          thickness={0.08}
        />
      </mesh>
      {/* Vertical metal mullions */}
      {Array.from({ length: n }, (_, i) => (
        <mesh key={i} position={[-(w - 0.24) / 2 + ((w - 0.24) / n) * (i + 0.5), 0, 0.02]} castShadow>
          <boxGeometry args={[0.03, fh * 0.40, 0.05]} />
          <meshStandardMaterial color="#1a202c" roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

function Facade({ spec, floor, faded, texture, brickMap }) {
  const FH = spec.floorHeight;
  const w = widthAt(spec, floor);
  const d = spec.depth;
  const y = floorY(spec, floor) + FH / 2;
  const isArches = spec.style === 'brick';
  // arches read as an open colonnade: keep the wall glassy behind them
  const solid = !isArches && spec.style !== 'glass';
  const opacity = faded ? 0.05 : solid ? 0.96 : 0.22;
  const t = 0.05;
  const wallMat = solid ? (
    <meshStandardMaterial color={spec.facadeColor} map={texture} transparent opacity={opacity} roughness={0.8} />
  ) : (
    <meshPhysicalMaterial color="#9fc9e8" transparent opacity={opacity} roughness={0.08} metalness={0.1} />
  );
  return (
    <group>
      <mesh position={[0, y, d / 2]}>
        <boxGeometry args={[w, FH - 0.15, t]} />
        {wallMat}
      </mesh>
      <mesh position={[0, y, -d / 2]}>
        <boxGeometry args={[w, FH - 0.15, t]} />
        {wallMat}
      </mesh>
      <mesh position={[-w / 2, y, 0]}>
        <boxGeometry args={[t, FH - 0.15, d]} />
        {wallMat}
      </mesh>
      <mesh position={[w / 2, y, 0]}>
        <boxGeometry args={[t, FH - 0.15, d]} />
        {wallMat}
      </mesh>
      {!faded && isArches && (
        <>
          <ArchRow w={w} fh={FH} y={y} z={d / 2 + 0.1} color={spec.facadeColor} map={brickMap} />
          <ArchRow w={w} fh={FH} y={y} z={-d / 2 - 0.1} color={spec.facadeColor} map={brickMap} />
        </>
      )}
      {!faded && solid && spec.windows === 'punched' && (
        <>
          <WindowGrid w={w} fh={FH} y={y} z={d / 2 + 0.04} windowColor={spec.windowColor} />
          <WindowGrid w={w} fh={FH} y={y} z={-d / 2 - 0.04} windowColor={spec.windowColor} />
        </>
      )}
      {!faded && solid && spec.windows !== 'punched' && (
        <>
          <RibbonWindows w={w} fh={FH} y={y} z={d / 2 + 0.04} windowColor={spec.windowColor} />
          <RibbonWindows w={w} fh={FH} y={y} z={-d / 2 - 0.04} windowColor={spec.windowColor} />
        </>
      )}
    </group>
  );
}

function Slab({ spec, f, texture }) {
  const w = Math.max(widthAt(spec, f), f > 0 ? widthAt(spec, f - 1) : 0);
  return (
    <mesh position={[0, floorY(spec, f), 0]} castShadow receiveShadow>
      <boxGeometry args={[w + 0.5, 0.15, spec.depth + 0.5]} />
      <meshStandardMaterial color={spec.slabColor} map={texture} roughness={0.8} />
    </mesh>
  );
}

function Columns({ spec, f, texture }) {
  const w = widthAt(spec, f);
  const y = floorY(spec, f) + spec.floorHeight / 2;
  return [-w / 2, 0, w / 2].flatMap((x) =>
    [-spec.depth / 2, spec.depth / 2].map((z) => (
      <mesh key={`${x}-${z}`} position={[x, y, z]} castShadow>
        <boxGeometry args={[0.14, spec.floorHeight, 0.14]} />
        <meshStandardMaterial color="#aab2ba" map={texture} roughness={0.8} />
      </mesh>
    )),
  );
}

function RoomInterior({ spec, zone, textures, selected }) {
  const w = widthAt(spec, zone.floor);
  const zw = w / 2;
  const cx = zoneCenterX(spec, zone.floor, zone.zoneIndex);
  const y = floorY(spec, zone.floor) + 0.08;
  const side = zone.zoneIndex === 0 ? -1 : 1;
  const finished = zone.roomType !== 'construction';

  // Parquet flooring for finished rooms, concrete for unfinished
  const floorMap = finished ? textures.parquet : textures.concrete;

  return (
    <group>
      {/* Flooring Mesh */}
      <mesh position={[cx, y + 0.005, 0]} receiveShadow>
        <boxGeometry args={[zw - 0.12, 0.02, spec.depth - 0.12]} />
        <meshStandardMaterial
          color={finished ? '#ffffff' : '#cfc8b8'}
          map={floorMap}
          roughness={finished ? 0.45 : 0.9}
        />
      </mesh>
      
      {/* Back partition wall */}
      {finished && (
        <mesh position={[cx, y + spec.floorHeight / 2, -spec.depth / 2 + 0.08]} receiveShadow>
          <boxGeometry args={[zw - 0.12, spec.floorHeight - 0.18, 0.02]} />
          <meshStandardMaterial color="#faf9f6" roughness={0.9} />
        </mesh>
      )}

      <RoomSet type={zone.roomType} cx={cx} y={y} side={side} depth={spec.depth} active={selected?.id === zone.id} />
    </group>
  );
}

function ZoneHotspot({ spec, zone, selected, hovered, onHover, onSelect }) {
  const FH = spec.floorHeight;
  const w = widthAt(spec, zone.floor);
  const cx = zoneCenterX(spec, zone.floor, zone.zoneIndex);
  const y = floorY(spec, zone.floor) + FH / 2;
  const color = COLORS[zone.risk];
  const opacity = selected ? 0.01 : hovered ? 0.28 : 0.08;
  return (
    <group>
      <mesh
        position={[cx, y, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(zone);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHover(zone.id);
        }}
        onPointerOut={() => onHover(null)}
      >
        <boxGeometry args={[w / 2 - 0.12, FH - 0.2, spec.depth - 0.12]} />
        <meshStandardMaterial color={color} transparent opacity={opacity} depthWrite={false} />
      </mesh>
      <mesh position={[cx, floorY(spec, zone.floor) + 0.12, spec.depth / 2 + 0.26]}>
        <boxGeometry args={[w / 2 - 0.4, 0.08, 0.06]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.4} toneMapped={false} />
      </mesh>
      {selected && (
        <pointLight position={[cx, y + 0.3, 0.4]} intensity={4.5} distance={5} decay={2} color="#fff2df" castShadow />
      )}
      {hovered && !selected && (
        <Html position={[cx, y + FH / 2 + 0.25, 0]} center style={{ pointerEvents: 'none' }}>
          <div
            dir="rtl"
            style={{
              background: 'rgba(20,26,34,0.92)', color: '#fff', padding: '6px 10px',
              borderRadius: 8, fontSize: 12, whiteSpace: 'nowrap', fontFamily: 'system-ui',
              border: `1px solid ${color}`,
            }}
          >
            {zone.label}
            {zone.prob != null ? ` · סיכון ${Math.round(zone.prob * 100)}%` : ''}
          </div>
        </Html>
      )}
    </group>
  );
}

function Building({ spec, zones, selected, hoveredId, onHover, onSelect, textures }) {
  // Setup textures repeat settings
  const facadeTex = useMemo(() => {
    const tex = spec.style === 'brick' ? textures.brick.clone() : textures.concrete.clone();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    // Repeat based on building scale
    tex.repeat.set(spec.baseWidth / 3.2, (spec.floors * spec.floorHeight) / 3.2);
    tex.needsUpdate = true;
    return tex;
  }, [spec, textures]);

  const slabTex = useMemo(() => {
    const tex = textures.concrete.clone();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(spec.baseWidth / 2.5, spec.depth / 2.5);
    tex.needsUpdate = true;
    return tex;
  }, [spec, textures]);

  return (
    <group>
      {Array.from({ length: spec.floors }, (_, f) => (
        <group key={f}>
          <Slab spec={spec} f={f} texture={slabTex} />
          <Columns spec={spec} f={f} texture={slabTex} />
          <Facade spec={spec} floor={f} faded={selected?.floor === f} texture={facadeTex} brickMap={textures.brick} />
          <mesh position={[0, floorY(spec, f) + spec.floorHeight / 2, -spec.depth / 4]} castShadow>
            <boxGeometry args={[0.08, spec.floorHeight - 0.15, spec.depth / 2]} />
            <meshStandardMaterial color="#eceff1" roughness={0.9} />
          </mesh>

          {/* Detailed Balcony Railings for Podun (recessed style) */}
          {spec.balconies === 'recessed' && !selected && (
            <group position={[0, floorY(spec, f) + spec.floorHeight / 2 - 0.45, spec.depth / 2 + 0.02]}>
              {/* Left Wing Balcony railing */}
              <group position={[-widthAt(spec, f) / 4, 0, 0]}>
                <mesh position={[0, 0.4, 0]} castShadow>
                  <boxGeometry args={[widthAt(spec, f) / 2 - 0.4, 0.03, 0.03]} />
                  <meshStandardMaterial color="#2d3748" roughness={0.7} />
                </mesh>
                {Array.from({ length: 10 }, (_, i) => (
                  <mesh key={i} position={[-(widthAt(spec, f) / 2 - 0.4) / 2 + ((widthAt(spec, f) / 2 - 0.4) / 9) * i, 0.2, 0]} castShadow>
                    <boxGeometry args={[0.015, 0.4, 0.015]} />
                    <meshStandardMaterial color="#2d3748" roughness={0.7} />
                  </mesh>
                ))}
              </group>
              {/* Right Wing Balcony railing */}
              <group position={[widthAt(spec, f) / 4, 0, 0]}>
                <mesh position={[0, 0.4, 0]} castShadow>
                  <boxGeometry args={[widthAt(spec, f) / 2 - 0.4, 0.03, 0.03]} />
                  <meshStandardMaterial color="#2d3748" roughness={0.7} />
                </mesh>
                {Array.from({ length: 10 }, (_, i) => (
                  <mesh key={i} position={[-(widthAt(spec, f) / 2 - 0.4) / 2 + ((widthAt(spec, f) / 2 - 0.4) / 9) * i, 0.2, 0]} castShadow>
                    <boxGeometry args={[0.015, 0.4, 0.015]} />
                    <meshStandardMaterial color="#2d3748" roughness={0.7} />
                  </mesh>
                ))}
              </group>
            </group>
          )}

          {/* Planter boxes on terraced setbacks (Penda Arcades style) */}
          {spec.balconies === 'terraces' && f > 0 && widthAt(spec, f) < widthAt(spec, f - 1) && (
            <group>
              {/* Left terrace planter */}
              <group position={[-widthAt(spec, f - 1) / 2 + (widthAt(spec, f - 1) - widthAt(spec, f)) / 4, floorY(spec, f) + 0.22, 0]}>
                <mesh castShadow receiveShadow>
                  <boxGeometry args={[(widthAt(spec, f - 1) - widthAt(spec, f)) / 2 - 0.1, 0.3, spec.depth - 0.2]} />
                  <meshStandardMaterial color={spec.facadeColor} map={textures.brick} roughness={0.8} />
                </mesh>
                {/* Plants leaves cascading */}
                {Array.from({ length: 5 }, (_, i) => (
                  <mesh key={i} position={[-0.22 + i * 0.11, 0.18, spec.depth / 2 - 0.16]} castShadow>
                    <sphereGeometry args={[0.11 - Math.random() * 0.02, 8, 8]} />
                    <meshStandardMaterial color={LEAF} roughness={0.9} />
                  </mesh>
                ))}
                {Array.from({ length: 4 }, (_, i) => (
                  <mesh key={i} position={[-0.15 + i * 0.11, 0.08, spec.depth / 2 - 0.06]} castShadow>
                    <sphereGeometry args={[0.085, 8, 8]} />
                    <meshStandardMaterial color={LEAF_LIGHT} roughness={0.9} />
                  </mesh>
                ))}
              </group>
              {/* Right terrace planter */}
              <group position={[widthAt(spec, f - 1) / 2 - (widthAt(spec, f - 1) - widthAt(spec, f)) / 4, floorY(spec, f) + 0.22, 0]}>
                <mesh castShadow receiveShadow>
                  <boxGeometry args={[(widthAt(spec, f - 1) - widthAt(spec, f)) / 2 - 0.1, 0.3, spec.depth - 0.2]} />
                  <meshStandardMaterial color={spec.facadeColor} map={textures.brick} roughness={0.8} />
                </mesh>
                {/* Plants leaves cascading */}
                {Array.from({ length: 5 }, (_, i) => (
                  <mesh key={i} position={[-0.22 + i * 0.11, 0.18, spec.depth / 2 - 0.16]} castShadow>
                    <sphereGeometry args={[0.11 - Math.random() * 0.02, 8, 8]} />
                    <meshStandardMaterial color={LEAF} roughness={0.9} />
                  </mesh>
                ))}
                {Array.from({ length: 4 }, (_, i) => (
                  <mesh key={i} position={[-0.15 + i * 0.11, 0.08, spec.depth / 2 - 0.06]} castShadow>
                    <sphereGeometry args={[0.085, 8, 8]} />
                    <meshStandardMaterial color={LEAF_LIGHT} roughness={0.9} />
                  </mesh>
                ))}
              </group>
            </group>
          )}
        </group>
      ))}

      {/* Roof slab */}
      <mesh position={[0, floorY(spec, spec.floors), 0]} castShadow receiveShadow>
        <boxGeometry args={[widthAt(spec, spec.floors - 1) + 0.5, 0.15, spec.depth + 0.5]} />
        <meshStandardMaterial color={spec.slabColor} map={slabTex} roughness={0.8} />
      </mesh>
      
      {/* AC units / Elevator shaft on roof */}
      <mesh position={[0, floorY(spec, spec.floors) + 0.25, 0]} castShadow>
        <boxGeometry args={[1.6, 0.5, 1.2]} />
        <meshStandardMaterial color="#b0bec5" map={slabTex} roughness={0.8} />
      </mesh>

      {zones.map((z) => (
        <RoomInterior key={`room-${z.id}`} spec={spec} zone={z} textures={textures} selected={selected} />
      ))}
      {zones.map((z) => (
        <ZoneHotspot
          key={z.id}
          spec={spec}
          zone={z}
          selected={selected?.id === z.id}
          hovered={hoveredId === z.id}
          onHover={onHover}
          onSelect={onSelect}
        />
      ))}
    </group>
  );
}

function CameraDirector({ spec, selected, controls }) {
  const firstRun = useRef(true);
  const H = spec.floors * spec.floorHeight;
  const dist = Math.max(spec.baseWidth * 2.2, H * 1.2);
  const overview = [dist * 0.75, H * 0.85 + 3, dist, 0, H * 0.45, 0];
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    c.smoothTime = 0.85;
    const animate = !firstRun.current;
    firstRun.current = false;
    if (selected) {
      const side = selected.zoneIndex === 0 ? -1 : 1;
      const cx = zoneCenterX(spec, selected.floor, selected.zoneIndex);
      const y = floorY(spec, selected.floor) + 1.0;
      c.setLookAt(
        cx - side * 1.15, y + 0.35, spec.depth / 2 + 0.7,
        cx + side * 0.45, y - 0.35, -spec.depth / 4,
        animate,
      );
    } else {
      c.setLookAt(...overview, animate);
    }
  }, [selected, controls, spec]);
  return null;
}

function DigitalTwinInner({ spec, selected, onSelect }) {
  const controls = useRef();
  const [hoveredId, setHoveredId] = useState(null);

  // Load high-resolution textures from public folder
  const textures = useTexture({
    concrete: '/assets/concrete_raw.png',
    brick: '/assets/terracotta_brick.png',
    parquet: '/assets/parquet_wood.png',
  });

  const zones = useMemo(() => zonesFor(spec), [spec]);
  const H = spec.floors * spec.floorHeight;
  const dist = Math.max(spec.baseWidth * 2.2, H * 1.2);

  useEffect(() => {
    document.body.style.cursor = hoveredId ? 'pointer' : 'auto';
    return () => (document.body.style.cursor = 'auto');
  }, [hoveredId]);

  return (
    <>
      <Sky sunPosition={[40, 30, 20]} turbidity={5} rayleigh={0.5} mieCoefficient={0.005} mieDirectionalG={0.8} />
      <fog attach="fog" args={['#dfe9f0', 40, 110]} />
      
      {/* Soft natural lighting setup */}
      <ambientLight intensity={0.45} />
      <hemisphereLight intensity={0.4} color="#eaeef4" groundColor="#78909c" />
      <directionalLight
        position={[14, Math.max(18, H + 8), 10]}
        intensity={1.25}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={Math.max(16, H + 4)}
        shadow-camera-bottom={-16}
      />
      
      <Building
        spec={spec}
        zones={zones}
        selected={selected}
        hoveredId={hoveredId}
        onHover={setHoveredId}
        onSelect={onSelect}
        textures={textures}
      />
      
      <mesh position={[0, -0.12, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[Math.max(26, H * 1.2), 48]} />
        <meshStandardMaterial color="#b5bfab" roughness={1.0} />
      </mesh>
      
      <ContactShadows position={[0, -0.03, 0]} opacity={0.45} scale={Math.max(24, H)} blur={2.2} far={8} />
      
      <CameraControls
        ref={controls}
        maxPolarAngle={Math.PI / 2 - 0.04}
        minDistance={0.8}
        maxDistance={Math.max(45, H * 2.2)}
      />
      
      <CameraDirector spec={spec} selected={selected} controls={controls} />
    </>
  );
}

export default function DigitalTwin({ spec, selected, onSelect }) {
  const H = spec.floors * spec.floorHeight;
  const dist = Math.max(spec.baseWidth * 2.2, H * 1.2);

  return (
    <Canvas
      shadows
      camera={{ position: [dist * 0.75, H * 0.85 + 3, dist], fov: 45 }}
      onPointerMissed={() => onSelect(null)}
    >
      <Suspense fallback={null}>
        <DigitalTwinInner spec={spec} selected={selected} onSelect={onSelect} />
      </Suspense>
    </Canvas>
  );
}
