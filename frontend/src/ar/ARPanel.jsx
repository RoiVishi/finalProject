/**
 * In-scene panels for AR — the zone detail card (AR-5) and the legend (AR-4).
 *
 * Why not HTML: the first version used a WebXR `dom-overlay`, which is the
 * right affordance on a handheld device. The lab hardware is a Meta Quest 3S,
 * and `dom-overlay` does not exist inside an immersive session there — an HTML
 * layer simply never appears. So the panels have to be objects in the scene.
 *
 * Why not drei's <Text>: it renders through troika, whose bidi handling for
 * Hebrew is not something we want to discover is wrong on demo day. Drawing to
 * a 2D canvas and using it as a texture costs nothing and gets RTL right,
 * because the browser's own text engine does the shaping (`ctx.direction`).
 *
 * The panels sit OUTSIDE the scaled model group and keep a fixed real-world
 * size (~34 cm wide), so they stay readable whatever scale the building is
 * placed at.
 */
import { useFrame, useThree } from '@react-three/fiber';
import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { LEGEND, RISK_COLORS, RISK_LABELS_HE } from './riskBands.js';

const PX = 2.5; // canvas pixels per layout unit — texture crispness

function makeSurface(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * PX);
  canvas.height = Math.round(h * PX);
  const ctx = canvas.getContext('2d');
  ctx.scale(PX, PX);
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  return { canvas, ctx, texture, w, h };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function card(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(14,20,27,0.92)';
  roundRect(ctx, 0, 0, w, h, 14);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/** Billboard toward the viewer; panels that face away are unreadable. */
function useBillboard(ref) {
  const { camera } = useThree();
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const p = new THREE.Vector3();
    camera.getWorldPosition(p);
    g.lookAt(p);
  });
}

/* ------------------------------------------------------------------ */
/* Zone detail (AR-5)                                                  */
/* ------------------------------------------------------------------ */

const ZONE_W = 260;
const ZONE_H = 190;

export function ZonePanel3D({ zone, position }) {
  const ref = useRef();
  const surface = useMemo(() => makeSurface(ZONE_W, ZONE_H), []);
  useBillboard(ref);

  useEffect(() => {
    if (!zone) return;
    const { ctx, texture } = surface;
    card(ctx, ZONE_W, ZONE_H);
    const R = ZONE_W - 16;
    let y = 14;

    ctx.fillStyle = '#ffffff';
    ctx.font = '700 19px system-ui, Arial';
    ctx.fillText(zone.label, R, y);
    y += 26;

    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.font = '14px system-ui, Arial';
    ctx.fillText(zone.status, R, y);
    y += 24;

    const pct = zone.prob != null ? Math.round(zone.prob * 100) : null;
    if (pct != null) {
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.font = '13px system-ui, Arial';
      ctx.fillText('סיכון עיכוב חזוי', R, y);
      y += 19;

      // bar
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      roundRect(ctx, 16, y + 3, ZONE_W - 32, 10, 5);
      ctx.fill();
      ctx.fillStyle = RISK_COLORS[zone.risk] ?? RISK_COLORS.unknown;
      const barW = Math.max(6, ((ZONE_W - 32) * pct) / 100);
      roundRect(ctx, ZONE_W - 16 - barW, y + 3, barW, 10, 5);
      ctx.fill();
      y += 20;

      ctx.font = '700 17px system-ui, Arial';
      ctx.fillText(`${pct}% · ${RISK_LABELS_HE[zone.risk] ?? ''}`, R, y);
      y += 26;
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.font = '14px system-ui, Arial';
      ctx.fillText(RISK_LABELS_HE.unknown, R, y);
      y += 26;
    }

    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = '13px system-ui, Arial';
    (zone.tasks ?? []).slice(0, 3).forEach((t) => {
      const line = t.length > 34 ? `${t.slice(0, 33)}…` : t;
      ctx.fillText(`· ${line}`, R, y);
      y += 18;
    });

    texture.needsUpdate = true;
  }, [zone, surface]);

  if (!zone || !position) return null;
  const scale = 0.34 / ZONE_W; // 34 cm wide in the real world
  return (
    <group ref={ref} position={position}>
      <mesh scale={[ZONE_W * scale, ZONE_H * scale, 1]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={surface.texture} transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Legend (AR-4)                                                       */
/* ------------------------------------------------------------------ */

const LEG_W = 230;
const LEG_H = 118;

export function Legend3D({ position }) {
  const ref = useRef();
  const surface = useMemo(() => makeSurface(LEG_W, LEG_H), []);
  useBillboard(ref);

  useEffect(() => {
    const { ctx, texture } = surface;
    card(ctx, LEG_W, LEG_H);
    const R = LEG_W - 14;
    let y = 12;
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 15px system-ui, Arial';
    ctx.fillText('סיכון עיכוב', R, y);
    y += 22;
    ctx.font = '13px system-ui, Arial';
    LEGEND.forEach((row) => {
      ctx.fillStyle = RISK_COLORS[row.key];
      roundRect(ctx, R - 13, y + 1, 13, 13, 3);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillText(row.label, R - 20, y);
      y += 20;
    });
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '12px system-ui, Arial';
    ctx.fillText('שקוף = טרם נבנה', R, y - 2);
    texture.needsUpdate = true;
  }, [surface]);

  if (!position) return null;
  const scale = 0.26 / LEG_W;
  return (
    <group ref={ref} position={position}>
      <mesh scale={[LEG_W * scale, LEG_H * scale, 1]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={surface.texture} transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Status line — one sentence, follows the view                        */
/* ------------------------------------------------------------------ */

const ST_W = 380;
const ST_H = 52;

export function StatusLine3D({ text }) {
  const ref = useRef();
  const { camera } = useThree();
  const surface = useMemo(() => makeSurface(ST_W, ST_H), []);

  useEffect(() => {
    const { ctx, texture } = surface;
    ctx.clearRect(0, 0, ST_W, ST_H);
    if (text) {
      ctx.fillStyle = 'rgba(14,20,27,0.88)';
      roundRect(ctx, 0, 0, ST_W, ST_H, 12);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = '15px system-ui, Arial';
      ctx.fillText(text.length > 52 ? `${text.slice(0, 51)}…` : text, ST_W - 16, 16);
    }
    texture.needsUpdate = true;
  }, [text, surface]);

  // Parented to the camera so it stays where the eye can find it.
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const p = new THREE.Vector3(0, -0.26, -1.1).applyMatrix4(camera.matrixWorld);
    g.position.copy(p);
    g.quaternion.copy(camera.quaternion);
  });

  if (!text) return null;
  const scale = 0.40 / ST_W;
  return (
    <group ref={ref}>
      <mesh scale={[ST_W * scale, ST_H * scale, 1]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={surface.texture} transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}
