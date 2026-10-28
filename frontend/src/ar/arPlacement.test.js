import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { isFloorLike, uprightAnchor } from './arPlacement.js';

const pose = (position, rotation) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(1, 1, 1),
  );
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const axis = (m, i) => new THREE.Vector3().setFromMatrixColumn(m, i).normalize();

test('isFloorLike: a floor or table counts, a wall or ceiling does not', () => {
  assert.equal(isFloorLike(pose([0, 0, -1], [0, 0, 0])), true); // level floor
  assert.equal(isFloorLike(pose([0, 0, -1], [0.2, 0, 0])), true); // slightly uneven table
  assert.equal(isFloorLike(pose([0, 1, -2], [Math.PI / 2, 0, 0])), false); // wall
  assert.equal(isFloorLike(pose([0, 2.5, 0], [Math.PI, 0, 0])), false); // ceiling
});

test('uprightAnchor: keeps the hit position and drops any tilt', () => {
  const tilted = pose([0.5, 0.7, -1.2], [0.4, 0.3, 0.25]);
  const m = uprightAnchor(tilted, new THREE.Vector3(0, 1.6, 0));
  const p = new THREE.Vector3().setFromMatrixPosition(m);
  close(p.x, 0.5); close(p.y, 0.7); close(p.z, -1.2);
  close(axis(m, 1).y, 1); // up is world up
});

test('uprightAnchor: the front (+Z) faces the viewer', () => {
  for (const viewer of [[0, 1.6, 0], [3, 1.6, -1], [-2, 1.2, -4]]) {
    const at = [0, 0, -1.5];
    const m = uprightAnchor(pose(at, [0, 0, 0]), new THREE.Vector3(...viewer));
    const toViewer = new THREE.Vector3(viewer[0] - at[0], 0, viewer[2] - at[2]).normalize();
    close(axis(m, 2).dot(toViewer), 1);
  }
});

test('uprightAnchor: a viewer straight above does not produce NaN', () => {
  const m = uprightAnchor(pose([1, 0, 1], [0, 0, 0]), new THREE.Vector3(1, 2, 1));
  assert.ok(m.elements.every(Number.isFinite));
});
