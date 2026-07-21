/**
 * Parametric furniture kit — premium designer pieces composed of high-quality
 * geometric primitives, materials, and textures. Includes interior lighting,
 * wood flooring, and wall art.
 */
import React from 'react';
import { useTexture } from '@react-three/drei';
import * as THREE from 'three';

const WOOD = '#8d6e63';
const WOOD_DARK = '#4e342e';
const FABRIC = '#37474f';
const FABRIC_LIGHT = '#b0bec5';
const ACCENT = '#1565c0';
const WHITE = '#fafafa';
const METAL = '#cfd8dc';
const LEAF = '#2e7d32';
const LEAF_LIGHT = '#66bb6a';
const POT = '#efebe9';

export function Sofa({ position, rotation = [0, 0, 0] }) {
  return (
    <group position={position} rotation={rotation}>
      {/* Wooden Base Frame */}
      <mesh position={[0, 0.05, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.25, 0.06, 0.54]} />
        <meshStandardMaterial color={WOOD_DARK} roughness={0.7} />
      </mesh>
      {/* 4 Wooden Legs */}
      {[[-0.58, -0.23], [0.58, -0.23], [-0.58, 0.23], [0.58, 0.23]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.02, z]} castShadow>
          <cylinderGeometry args={[0.02, 0.015, 0.05, 8]} />
          <meshStandardMaterial color={WOOD_DARK} roughness={0.6} />
        </mesh>
      ))}
      {/* Main Seat Cushions */}
      <mesh position={[-0.3, 0.16, 0]} castShadow>
        <boxGeometry args={[0.58, 0.16, 0.5]} />
        <meshStandardMaterial color={FABRIC} roughness={0.9} />
      </mesh>
      <mesh position={[0.3, 0.16, 0]} castShadow>
        <boxGeometry args={[0.58, 0.16, 0.5]} />
        <meshStandardMaterial color={FABRIC} roughness={0.9} />
      </mesh>
      {/* Backrest Cushions */}
      <mesh position={[-0.3, 0.34, -0.21]} castShadow>
        <boxGeometry args={[0.58, 0.24, 0.12]} />
        <meshStandardMaterial color={FABRIC} roughness={0.9} />
      </mesh>
      <mesh position={[0.3, 0.34, -0.21]} castShadow>
        <boxGeometry args={[0.58, 0.24, 0.12]} />
        <meshStandardMaterial color={FABRIC} roughness={0.9} />
      </mesh>
      {/* Left/Right Armrests */}
      {[-0.61, 0.61].map((x) => (
        <mesh key={x} position={[x, 0.24, 0]} castShadow>
          <boxGeometry args={[0.08, 0.26, 0.54]} />
          <meshStandardMaterial color={FABRIC} roughness={0.9} />
        </mesh>
      ))}
      {/* Decorative Accent Cushions */}
      <mesh position={[-0.45, 0.24, 0.14]} rotation={[0, 0.15, 0]} castShadow>
        <boxGeometry args={[0.18, 0.18, 0.06]} />
        <meshStandardMaterial color="#b3e5fc" roughness={0.8} />
      </mesh>
      <mesh position={[0.45, 0.24, 0.14]} rotation={[0, -0.15, 0]} castShadow>
        <boxGeometry args={[0.18, 0.18, 0.06]} />
        <meshStandardMaterial color="#ffe082" roughness={0.8} />
      </mesh>
    </group>
  );
}

export function CoffeeTable({ position }) {
  return (
    <group position={position}>
      {/* Top Panel */}
      <mesh position={[0, 0.16, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.65, 0.03, 0.42]} />
        <meshStandardMaterial color={WOOD} roughness={0.5} />
      </mesh>
      {/* Lower Glass Shelf */}
      <mesh position={[0, 0.09, 0]} castShadow>
        <boxGeometry args={[0.55, 0.015, 0.32]} />
        <meshPhysicalMaterial color="#fff" transparent opacity={0.4} roughness={0.1} transmission={0.9} thickness={0.05} />
      </mesh>
      {/* Thin Metal Legs */}
      {[[-0.28, -0.18], [0.28, -0.18], [-0.28, 0.18], [0.28, 0.18]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.08, z]} castShadow>
          <cylinderGeometry args={[0.015, 0.015, 0.15, 8]} />
          <meshStandardMaterial color="#263238" metalness={0.8} roughness={0.2} />
        </mesh>
      ))}
      {/* Small table book decoration */}
      <mesh position={[0.1, 0.18, 0.05]} rotation={[0, 0.2, 0]} castShadow>
        <boxGeometry args={[0.15, 0.015, 0.11]} />
        <meshStandardMaterial color={ACCENT} roughness={0.8} />
      </mesh>
    </group>
  );
}

export function Bed({ position, rotation = [0, 0, 0], active }) {
  return (
    <group position={position} rotation={rotation}>
      {/* Wooden Frame */}
      <mesh position={[0, 0.08, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.95, 0.14, 1.4]} />
        <meshStandardMaterial color={WOOD_DARK} roughness={0.7} />
      </mesh>
      {/* Tall Headboard */}
      <mesh position={[0, 0.42, -0.68]} castShadow>
        <boxGeometry args={[0.95, 0.54, 0.05]} />
        <meshStandardMaterial color={WOOD_DARK} roughness={0.7} />
      </mesh>
      {/* Mattress */}
      <mesh position={[0, 0.19, 0.02]} castShadow>
        <boxGeometry args={[0.88, 0.14, 1.3]} />
        <meshStandardMaterial color={WHITE} roughness={0.9} />
      </mesh>
      {/* Blanket Cover (neatly folded) */}
      <mesh position={[0, 0.22, 0.2]} castShadow>
        <boxGeometry args={[0.9, 0.1, 0.9]} />
        <meshStandardMaterial color="#304ffe" roughness={0.85} />
      </mesh>
      {/* 2 Soft Pillows */}
      {[-0.2, 0.2].map((x) => (
        <mesh key={x} position={[x, 0.28, -0.42]} rotation={[-0.15, 0, 0]} castShadow>
          <boxGeometry args={[0.26, 0.06, 0.2]} />
          <meshStandardMaterial color={WHITE} roughness={0.95} />
        </mesh>
      ))}
      {/* Nightstands on each side */}
      {[-0.64, 0.64].map((x, i) => (
        <group key={i} position={[x, 0, -0.45]}>
          <mesh position={[0, 0.12, 0]} castShadow receiveShadow>
            <boxGeometry args={[0.22, 0.24, 0.25]} />
            <meshStandardMaterial color={WOOD_DARK} roughness={0.7} />
          </mesh>
          <mesh position={[0, 0.16, 0.12]}>
            <boxGeometry args={[0.12, 0.02, 0.02]} />
            <meshStandardMaterial color={METAL} metalness={0.9} roughness={0.1} />
          </mesh>
          {/* Nightstand Lamp */}
          <group position={[0, 0.24, 0]}>
            {/* Lamp base */}
            <mesh position={[0, 0.03, 0]} castShadow>
              <cylinderGeometry args={[0.03, 0.04, 0.06, 10]} />
              <meshStandardMaterial color={METAL} metalness={0.9} roughness={0.2} />
            </mesh>
            {/* Lamp Shade */}
            <mesh position={[0, 0.14, 0]} castShadow>
              <cylinderGeometry args={[0.05, 0.07, 0.12, 12]} />
              <meshStandardMaterial color="#fff" roughness={0.9} emissive="#fff" emissiveIntensity={active ? 0.6 : 0.0} />
            </mesh>
            {/* Tiny Soft PointLight */}
            {active && (
              <pointLight position={[0, 0.14, 0]} intensity={0.75} distance={1.8} color="#ffe082" decay={2} castShadow />
            )}
          </group>
        </group>
      ))}
    </group>
  );
}

export function Wardrobe({ position, rotation = [0, 0, 0] }) {
  return (
    <group position={position} rotation={rotation}>
      {/* Wardrobe Body */}
      <mesh position={[0, 0.62, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.85, 1.24, 0.38]} />
        <meshStandardMaterial color={WOOD} roughness={0.8} />
      </mesh>
      {/* 2 Doors (subtle relief) */}
      {[-0.205, 0.205].map((x) => (
        <mesh key={x} position={[x, 0.62, 0.192]} castShadow>
          <boxGeometry args={[0.39, 1.2, 0.01]} />
          <meshStandardMaterial color={WOOD_DARK} roughness={0.7} />
        </mesh>
      ))}
      {/* Metal Door Handles */}
      {[-0.04, 0.04].map((x) => (
        <mesh key={x} position={[x, 0.65, 0.202]} castShadow>
          <boxGeometry args={[0.015, 0.16, 0.01]} />
          <meshStandardMaterial color={METAL} metalness={0.9} roughness={0.1} />
        </mesh>
      ))}
    </group>
  );
}

export function DiningSet({ position }) {
  return (
    <group position={position}>
      {/* Round Wooden Table Top */}
      <mesh position={[0, 0.28, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.36, 0.36, 0.03, 24]} />
        <meshStandardMaterial color={WOOD} roughness={0.5} />
      </mesh>
      {/* Metal Central Leg */}
      <mesh position={[0, 0.13, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.03, 0.27, 12]} />
        <meshStandardMaterial color="#263238" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.01, 0]} receiveShadow>
        <cylinderGeometry args={[0.18, 0.18, 0.02, 16]} />
        <meshStandardMaterial color="#263238" metalness={0.8} roughness={0.3} />
      </mesh>

      {/* 4 Chairs with legs and backrests */}
      {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((a, idx) => {
        const cx = Math.cos(a) * 0.46;
        const cz = Math.sin(a) * 0.46;
        return (
          <group key={idx} position={[cx, 0, cz]} rotation={[0, -a + Math.PI, 0]}>
            {/* Chair Seat */}
            <mesh position={[0, 0.16, 0]} castShadow>
              <boxGeometry args={[0.22, 0.02, 0.22]} />
              <meshStandardMaterial color={WOOD_DARK} roughness={0.8} />
            </mesh>
            {/* Chair Backrest */}
            <mesh position={[0, 0.32, -0.095]} castShadow>
              <boxGeometry args={[0.2, 0.28, 0.02]} />
              <meshStandardMaterial color={WOOD_DARK} roughness={0.8} />
            </mesh>
            {/* 4 Thin Legs */}
            {[[-0.09, -0.09], [0.09, -0.09], [-0.09, 0.09], [0.09, 0.09]].map(([lx, lz], j) => (
              <mesh key={j} position={[lx, 0.08, lz]} castShadow>
                <cylinderGeometry args={[0.01, 0.01, 0.16, 8]} />
                <meshStandardMaterial color="#263238" metalness={0.7} roughness={0.3} />
              </mesh>
            ))}
          </group>
        );
      })}
      {/* Small table vase centerpiece */}
      <mesh position={[0, 0.32, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.02, 0.06, 12]} />
        <meshStandardMaterial color={POT} roughness={0.2} />
      </mesh>
      <mesh position={[0, 0.36, 0]}>
        <sphereGeometry args={[0.02, 8, 8]} />
        <meshStandardMaterial color={LEAF} roughness={0.9} />
      </mesh>
    </group>
  );
}

export function KitchenCounter({ position, rotation = [0, 0, 0] }) {
  return (
    <group position={position} rotation={rotation}>
      {/* Matte White Kitchen Cabinet base */}
      <mesh position={[0, 0.26, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.15, 0.52, 0.36]} />
        <meshStandardMaterial color="#eeeeee" roughness={0.4} />
      </mesh>
      {/* Marble/Dark countertop */}
      <mesh position={[0, 0.535, 0]} castShadow>
        <boxGeometry args={[1.2, 0.03, 0.39]} />
        <meshStandardMaterial color="#37474f" roughness={0.3} metalness={0.1} />
      </mesh>
      {/* Kitchen Sink */}
      <mesh position={[-0.2, 0.551, 0]} castShadow>
        <boxGeometry args={[0.26, 0.002, 0.22]} />
        <meshStandardMaterial color={METAL} metalness={0.9} roughness={0.1} />
      </mesh>
      <mesh position={[-0.2, 0.6, -0.08]} rotation={[0, 0, 0]} castShadow>
        <cylinderGeometry args={[0.008, 0.008, 0.1, 8]} />
        <meshStandardMaterial color={METAL} metalness={0.9} roughness={0.1} />
      </mesh>
      {/* Tall refrigerator next to counter */}
      <group position={[0.72, 0, 0]}>
        <mesh position={[0, 0.52, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.36, 1.04, 0.38]} />
          <meshStandardMaterial color="#cfd8dc" metalness={0.5} roughness={0.3} />
        </mesh>
        {/* Refrigerator handles */}
        <mesh position={[0.16, 0.72, 0.2]} castShadow>
          <boxGeometry args={[0.015, 0.22, 0.01]} />
          <meshStandardMaterial color={METAL} metalness={0.9} roughness={0.1} />
        </mesh>
        <mesh position={[0.16, 0.28, 0.2]} castShadow>
          <boxGeometry args={[0.015, 0.16, 0.01]} />
          <meshStandardMaterial color={METAL} metalness={0.9} roughness={0.1} />
        </mesh>
      </group>
    </group>
  );
}

export function Desk({ position, rotation = [0, 0, 0], active }) {
  return (
    <group position={position} rotation={rotation}>
      {/* Wood Tabletop */}
      <mesh position={[0, 0.28, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.9, 0.03, 0.45]} />
        <meshStandardMaterial color={WOOD} roughness={0.6} />
      </mesh>
      {/* Black Metal Legs */}
      {[[-0.41, -0.19], [0.41, -0.19], [-0.41, 0.19], [0.41, 0.19]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.14, z]} castShadow>
          <cylinderGeometry args={[0.012, 0.012, 0.28, 8]} />
          <meshStandardMaterial color="#263238" metalness={0.8} roughness={0.3} />
        </mesh>
      ))}
      {/* Modern Laptop */}
      <group position={[0, 0.295, 0]}>
        <mesh position={[0, 0.005, 0.02]} castShadow>
          <boxGeometry args={[0.22, 0.01, 0.15]} />
          <meshStandardMaterial color="#90a4ae" metalness={0.8} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.08, -0.05]} rotation={[-0.25, 0, 0]} castShadow>
          <boxGeometry args={[0.22, 0.15, 0.008]} />
          <meshStandardMaterial color="#90a4ae" metalness={0.8} roughness={0.3} />
        </mesh>
        {/* Glowing Screen */}
        <mesh position={[0, 0.08, -0.044]} rotation={[-0.25, 0, 0]}>
          <planeGeometry args={[0.20, 0.13]} />
          <meshBasicMaterial color="#e0f7fa" toneMapped={false} />
        </mesh>
      </group>
      {/* Office Chair */}
      <group position={[0, 0, 0.32]}>
        <mesh position={[0, 0.15, 0]} castShadow>
          <boxGeometry args={[0.24, 0.02, 0.24]} />
          <meshStandardMaterial color="#263238" roughness={0.8} />
        </mesh>
        <mesh position={[0, 0.34, -0.11]} castShadow>
          <boxGeometry args={[0.22, 0.26, 0.02]} />
          <meshStandardMaterial color="#263238" roughness={0.8} />
        </mesh>
        {/* Central piston */}
        <mesh position={[0, 0.07, 0]} castShadow>
          <cylinderGeometry args={[0.02, 0.02, 0.14, 8]} />
          <meshStandardMaterial color="#b0bec5" metalness={0.8} roughness={0.2} />
        </mesh>
      </group>
    </group>
  );
}

export function Plant({ position }) {
  return (
    <group position={position}>
      {/* Minimalist Ceramic Pot */}
      <mesh position={[0, 0.08, 0]} castShadow>
        <cylinderGeometry args={[0.08, 0.06, 0.16, 12]} />
        <meshStandardMaterial color={POT} roughness={0.3} />
      </mesh>
      {/* Plant Stems and Leaves */}
      <group position={[0, 0.16, 0]}>
        {/* Stems */}
        <mesh position={[0, 0.08, 0]} rotation={[0.1, 0, 0.15]} castShadow>
          <cylinderGeometry args={[0.008, 0.005, 0.16, 6]} />
          <meshStandardMaterial color="#5d4037" />
        </mesh>
        <mesh position={[0, 0.08, 0]} rotation={[-0.15, 0, -0.1]} castShadow>
          <cylinderGeometry args={[0.008, 0.005, 0.14, 6]} />
          <meshStandardMaterial color="#5d4037" />
        </mesh>
        {/* Organic-looking clusters of leaves */}
        <mesh position={[0.04, 0.18, 0.03]} castShadow>
          <sphereGeometry args={[0.11, 10, 8]} />
          <meshStandardMaterial color={LEAF} roughness={0.9} />
        </mesh>
        <mesh position={[-0.04, 0.15, -0.03]} castShadow>
          <sphereGeometry args={[0.09, 10, 8]} />
          <meshStandardMaterial color={LEAF_LIGHT} roughness={0.9} />
        </mesh>
        <mesh position={[0.0, 0.22, -0.02]} castShadow>
          <sphereGeometry args={[0.08, 10, 8]} />
          <meshStandardMaterial color={LEAF} roughness={0.9} />
        </mesh>
      </group>
    </group>
  );
}

export function Rug({ position, color = '#b0bec5' }) {
  return (
    <mesh position={[position[0], position[1] + 0.002, position[2]]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[0.9, 0.7]} />
      <meshStandardMaterial color={color} roughness={0.95} />
    </mesh>
  );
}

export function WallArt({ position, rotation = [0, 0, 0] }) {
  const artTex = useTexture('/assets/art_painting_modern.png');
  return (
    <group position={position} rotation={rotation}>
      {/* Shadow-casting Frame back */}
      <mesh castShadow>
        <boxGeometry args={[0.45, 0.55, 0.015]} />
        <meshStandardMaterial color="#2d221c" roughness={0.8} />
      </mesh>
      {/* Matte print paper */}
      <mesh position={[0, 0, 0.008]}>
        <planeGeometry args={[0.42, 0.52]} />
        <meshStandardMaterial map={artTex} roughness={0.4} />
      </mesh>
    </group>
  );
}

/** Construction-site equipment (with detailed hazard stripes and props) */
export function SiteEquipment({ position, side }) {
  const [x, y, z] = position;
  return (
    <group>
      {/* Wooden crate */}
      <mesh position={[x - side * 0.45, y + 0.16, z + 0.45]} castShadow>
        <boxGeometry args={[0.4, 0.32, 0.4]} />
        <meshStandardMaterial color="#b0895a" roughness={0.95} />
      </mesh>
      {/* Tool cabinet box */}
      <mesh position={[x - side * 0.05, y + 0.2, z + 0.65]} castShadow>
        <boxGeometry args={[0.26, 0.4, 0.26]} />
        <meshStandardMaterial color="#f44336" roughness={0.8} />
      </mesh>
      {/* Stacked Cement Bags */}
      <mesh position={[x + side * 0.45, y + 0.06, z + 0.3]} rotation={[0, 0.2, 0]} castShadow>
        <boxGeometry args={[0.32, 0.1, 0.2]} />
        <meshStandardMaterial color="#9e9e9e" roughness={1.0} />
      </mesh>
      <mesh position={[x + side * 0.48, y + 0.15, z + 0.32]} rotation={[0, -0.1, 0]} castShadow>
        <boxGeometry args={[0.32, 0.1, 0.2]} />
        <meshStandardMaterial color="#8d8d8d" roughness={1.0} />
      </mesh>
      {/* Sawhorse with yellow-black hazard bar */}
      <group position={[x + side * 0.65, y, z - 0.4]}>
        <mesh position={[0, 0.26, 0]} castShadow>
          <boxGeometry args={[0.6, 0.05, 0.08]} />
          <meshStandardMaterial color="#ffeb3b" roughness={0.7} />
        </mesh>
        <mesh position={[0, 0.26, 0.042]}>
          <boxGeometry args={[0.54, 0.03, 0.002]} />
          <meshStandardMaterial color="#212121" roughness={0.7} />
        </mesh>
        {[-0.24, 0.24].map((dx) => (
          <mesh key={dx} position={[dx, 0.12, 0]} rotation={[0.25, 0, 0]} castShadow>
            <boxGeometry args={[0.04, 0.26, 0.04]} />
            <meshStandardMaterial color={WOOD} roughness={0.9} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

export function RoomSet({ type, cx, y, side, depth, active }) {
  const back = -depth / 2 + 0.5;
  switch (type) {
    case 'living':
      return (
        <group>
          <Sofa position={[cx + side * 0.4, y, back + 0.15]} />
          <CoffeeTable position={[cx + side * 0.4, y, back + 0.85]} />
          <Rug position={[cx + side * 0.4, y, back + 0.85]} color="#b0bec5" />
          <Plant position={[cx - side * 0.95, y, back + 0.12]} />
          <WallArt position={[cx - side * 0.3, y + 0.6, back + 0.01]} />
        </group>
      );
    case 'bedroom':
      return (
        <group>
          <Bed position={[cx - side * 0.25, y, back + 0.55]} active={active} />
          <Wardrobe position={[cx + side * 0.92, y, back + 0.05]} />
          <Plant position={[cx + side * 0.92, y, back + 1.25]} />
          <WallArt position={[cx - side * 0.25, y + 0.85, back + 0.01]} />
        </group>
      );
    case 'dining':
      return (
        <group>
          <KitchenCounter position={[cx - side * 0.5, y, back]} />
          <DiningSet position={[cx + side * 0.65, y, back + 1.15]} />
        </group>
      );
    case 'office':
      return (
        <group>
          <Desk position={[cx, y, back + 0.3]} active={active} />
          <Wardrobe position={[cx + side * 0.96, y, back + 0.05]} />
          <Plant position={[cx - side * 0.96, y, back + 0.12]} />
          <Rug position={[cx, y, back + 0.95]} color="#90a4ae" />
          <WallArt position={[cx, y + 0.72, back + 0.01]} />
        </group>
      );
    default:
      return <SiteEquipment position={[cx, y, 0]} side={side} />;
  }
}
