/**
 * Size of the building inside an AR session, and the one-line status copy
 * after a pick. Pure functions, no three.js, so they are unit-tested directly.
 *
 * Why this exists: the first version used a fixed scale of 0.02. The demo
 * building is 5 floors x 1.7 units, so on the Quest 3S it stood 17 cm tall,
 * which was too small to be convincing and too small to aim at reliably
 * (found in the first test on the headset, 27.10.26).
 */

/** Height of the placed building in metres, whatever its number of floors. */
export const AR_TARGET_HEIGHT_M = 1.0;

/** How far the thumbstick may shrink or grow it from that height. */
export const AR_SCALE_MIN = 0.25;
export const AR_SCALE_MAX = 4;

/** Thumbstick values smaller than this are treated as the stick at rest. */
export const STICK_DEADZONE = 0.2;

/** Full stick deflection changes the size by e^0.9 (about x2.5) per second. */
const STICK_RATE = 0.9;

/** Scale that makes the whole building AR_TARGET_HEIGHT_M tall. */
export function fitScale(spec) {
  const h = (spec?.floors ?? 0) * (spec?.floorHeight ?? 0);
  return h > 0 ? AR_TARGET_HEIGHT_M / h : 0.02;
}

/**
 * Next size multiplier from the thumbstick. `axisY` is the gamepad's vertical
 * thumbstick axis: negative when pushed forward (grow), positive when pulled
 * back (shrink). `dt` is the frame time in seconds.
 */
export function nextScaleMul(mul, axisY, dt) {
  if (!Number.isFinite(axisY) || Math.abs(axisY) < STICK_DEADZONE) return mul;
  const next = mul * Math.exp(-axisY * STICK_RATE * Math.min(dt, 0.1));
  return Math.min(AR_SCALE_MAX, Math.max(AR_SCALE_MIN, next));
}

/** Vertical thumbstick axis of the first controller that has one (Quest: axes[3]). */
export function thumbstickY(inputSources) {
  for (const src of inputSources ?? []) {
    const axes = src?.gamepad?.axes;
    if (axes && axes.length >= 4 && Math.abs(axes[3]) >= STICK_DEADZONE) return axes[3];
  }
  return 0;
}

export const STATUS_AFTER_PLACE = 'כוונו את הקרן אל קומה ולחצו · ג׳ויסטיק: הגדלה / הקטנה';
export const STATUS_MISSED = 'לא נבחר אזור — כוונו את הקרן אל אחת הקומות';

/**
 * Status line after the trigger is pressed on a placed building. A successful
 * pick must replace the "missed" line; before this fix it stayed on screen
 * after the user had already selected a floor.
 */
export function statusAfterPick(zone) {
  return zone ? `נבחר: ${zone.label}` : STATUS_MISSED;
}
