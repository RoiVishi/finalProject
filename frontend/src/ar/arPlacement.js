/**
 * Where and how the building stands when it is placed (AR-2).
 *
 * The first version used the hit-test pose as it came. A hit on a wall or a
 * sloped surface then laid the building on its side, because the pose's up
 * axis is the surface normal (seen in the Immersive Web Emulator, 28.10.26).
 *
 * Two rules now:
 *   1. Only a roughly horizontal, upward-facing surface (floor, table) can take
 *      the building. Walls and ceilings show no reticle.
 *   2. From the hit we keep only the position. The building always stands
 *      upright, turned so its front (local +Z, as in the 2D Twin) faces the
 *      viewer at the moment of placement.
 */
import * as THREE from 'three';

/** cos(~37 deg): how far from level a surface may tilt and still count as a floor. */
export const MIN_UP_DOT = 0.8;

const UP = new THREE.Vector3(0, 1, 0);

/** True when the hit pose's up axis (its surface normal) points upward. */
export function isFloorLike(hitMatrix) {
  const normal = new THREE.Vector3().setFromMatrixColumn(hitMatrix, 1).normalize();
  return normal.dot(UP) >= MIN_UP_DOT;
}

/**
 * Upright placement matrix: the hit position, no tilt, front turned toward
 * `viewerPos` (a THREE.Vector3 in the same space).
 */
export function uprightAnchor(hitMatrix, viewerPos) {
  const p = new THREE.Vector3().setFromMatrixPosition(hitMatrix);
  const dx = viewerPos.x - p.x;
  const dz = viewerPos.z - p.z;
  const yaw = dx === 0 && dz === 0 ? 0 : Math.atan2(dx, dz);
  const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
  return new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1));
}
