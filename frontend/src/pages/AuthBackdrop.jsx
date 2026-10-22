import React, { useEffect, useState } from 'react';

/**
 * Decorative background of the auth screens: a residential building drawn in
 * glowing blueprint lines, a courtyard with real young trees and shrubs, and
 * the AR layer the product adds on site - ground anchor, corner brackets, a
 * scan line and one floor flagged by its delay risk. Pure decoration:
 * aria-hidden, no text a screen reader needs, no network beyond /auth/*.webp.
 *
 * The scene is drawn on a 1440x900 stage that covers the viewport. On narrow
 * (phone) screens the whole building is fitted to the top of the screen
 * instead, and the card sits below it (auth.css).
 * Plant photos: Pixabay (free under the Pixabay Content License), cut out and
 * graded to dusk; see public/auth/README.md.
 */
const WIDE = '0 0 1440 900';
const NARROW = '200 40 620 860';
const NARROW_QUERY = '(max-width: 760px)';

function useNarrow() {
  const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(NARROW_QUERY) : null;
  const [narrow, setNarrow] = useState(Boolean(mq?.matches));
  useEffect(() => {
    if (!mq) return undefined;
    const on = (e) => setNarrow(e.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, [mq]);
  return narrow;
}

const FLOOR_LINES = 'M300 252.5H600M300 325H600M300 397.5H600M300 470H600M300 542.5H600M300 615H600M300 687.5H600'
  + 'M600 252.5L740 289.5M600 325L740 353M600 397.5L740 416.5M600 470L740 480M600 542.5L740 543.5M600 615L740 607M600 687.5L740 670.5';
const SLATS = Array.from({ length: 11 }, (_, i) => `M${572 + i * 12} 745V797`).join('')
  + Array.from({ length: 16 }, (_, i) => `M${716 + i * 12} 770V800`).join('');

export default function AuthBackdrop() {
  const narrow = useNarrow();
  return (
    <svg className="auth-backdrop" aria-hidden="true" focusable="false"
         viewBox={narrow ? NARROW : WIDE} preserveAspectRatio={narrow ? 'xMidYMin meet' : 'xMidYMid slice'}>
      <defs>
        <linearGradient id="fs-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#050a18" /><stop offset="1" stopColor="#0a1633" />
        </linearGradient>
        <radialGradient id="fs-halo" cx="520" cy="470" r="440" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2563eb" stopOpacity="0.38" />
          <stop offset="0.55" stopColor="#1d4ed8" stopOpacity="0.12" />
          <stop offset="1" stopColor="#1d4ed8" stopOpacity="0" />
        </radialGradient>
        <pattern id="fs-grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M40 0H0V40" fill="none" stroke="#3b82f6" strokeOpacity="0.07" />
        </pattern>
        <pattern id="fs-win-front" x="300" y="180" width="75" height="72.5" patternUnits="userSpaceOnUse">
          <rect x="17" y="18" width="41" height="36" rx="2" fill="#60a5fa" fillOpacity="0.08" stroke="#60a5fa" strokeOpacity="0.45" />
        </pattern>
        <pattern id="fs-win-side" x="600" y="180" width="35" height="66" patternUnits="userSpaceOnUse" patternTransform="skewY(6)">
          <rect x="8" y="17" width="19" height="32" rx="2" fill="#60a5fa" fillOpacity="0.05" stroke="#60a5fa" strokeOpacity="0.3" />
        </pattern>
        <clipPath id="fs-side"><polygon points="600,180 740,226 740,734 600,760" /></clipPath>
        <filter id="fs-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="5" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <linearGradient id="fs-scan-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#22d3ee" stopOpacity="0" /><stop offset="1" stopColor="#22d3ee" stopOpacity="0.22" />
        </linearGradient>
        <radialGradient id="fs-lamp" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fde68a" stopOpacity="0.5" /><stop offset="1" stopColor="#fde68a" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* sky, blueprint grid, glow */}
      <rect width="1440" height="900" fill="url(#fs-bg)" />
      <rect width="1440" height="900" fill="url(#fs-grid)" />
      <circle cx="520" cy="470" r="440" fill="url(#fs-halo)" />

      {/* lawn and gravel path */}
      <path d="M-200 772H1640V1100H-200Z" fill="#0a221b" />
      <path d="M-200 772H1640" stroke="#1e3a2f" strokeWidth="2" />
      <polygon points="520,772 604,772 790,900 400,900" fill="#232c40" />
      <path d="M520 772L400 900M604 772L790 900" stroke="#3a465e" strokeWidth="3" />

      {/* the building */}
      <polygon points="300,180 600,180 600,760 300,760" fill="#0b1a3a" fillOpacity="0.85" />
      <rect x="300" y="180" width="300" height="580" fill="url(#fs-win-front)" />
      <polygon points="600,180 740,226 740,734 600,760" fill="#081430" fillOpacity="0.9" />
      <g clipPath="url(#fs-side)"><rect x="600" y="150" width="140" height="640" fill="url(#fs-win-side)" /></g>
      <path d={FLOOR_LINES} fill="none" stroke="#60a5fa" strokeOpacity="0.35" />
      <rect x="300" y="542.5" width="300" height="72.5" fill="#f59e0b" fillOpacity="0.16" stroke="#fbbf24" strokeOpacity="0.9" strokeWidth="1.5" />
      <polygon points="600,542.5 740,543.5 740,607 600,615" fill="#f59e0b" fillOpacity="0.1" stroke="#fbbf24" strokeOpacity="0.7" />
      <rect x="270" y="758" width="500" height="14" fill="#1b2640" />

      {/* courtyard: real young trees and shrubs */}
      <image href="/auth/tree-young-1.webp" x="160" y="527" width="181" height="270" />
      <image href="/auth/tree-young-2.webp" x="440" y="547" width="114" height="250" />
      <image href="/auth/tree-young-3.webp" x="655" y="545" width="133" height="240" />
      <image href="/auth/tree-young-4.webp" x="805" y="588" width="130" height="210" />
      <image href="/auth/shrub-hydrangea.webp" x="0" y="690" width="200" height="112" />
      <image href="/auth/shrub-hydrangea.webp" x="262" y="676" width="220" height="124" />
      <image href="/auth/shrub-hydrangea.webp" x="578" y="640" width="190" height="107" />

      {/* stakes, lamp post, planter bench */}
      <path d="M240 712V800M262 712V800M238 730H264M487 712V800M509 712V800M485 730H511M857 712V800M879 712V800M855 730H881"
            stroke="#8a6f52" strokeWidth="3" strokeLinecap="round" />
      <circle cx="382" cy="636" r="34" fill="url(#fs-lamp)" />
      <circle cx="444" cy="622" r="34" fill="url(#fs-lamp)" />
      <path d="M415 802V690L384 640M415 676L444 626" fill="none" stroke="#3b4659" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="376" y="632" width="14" height="6" rx="2" fill="#fef3c7" transform="rotate(58 383 635)" />
      <rect x="437" y="618" width="14" height="6" rx="2" fill="#fef3c7" transform="rotate(-58 444 621)" />
      <rect x="556" y="736" width="218" height="9" fill="#6b5440" />
      <rect x="560" y="745" width="210" height="52" fill="#4a3a2c" />
      <rect x="700" y="762" width="210" height="8" fill="#735a43" />
      <rect x="704" y="770" width="202" height="30" fill="#574431" />
      <path d={SLATS} stroke="#33271c" strokeOpacity="0.7" strokeWidth="1.2" />

      {/* the AR layer */}
      <ellipse className="fs-pulse" cx="520" cy="782" rx="330" ry="44" fill="none" stroke="#22d3ee" strokeOpacity="0.6" strokeDasharray="6 8" strokeWidth="1.5" />
      <ellipse cx="520" cy="782" rx="250" ry="30" fill="#2563eb" fillOpacity="0.08" stroke="#60a5fa" strokeOpacity="0.35" />
      <path d="M300 760V180H600V760ZM600 180L740 226V734L600 760M420 180V146H520V180M470 146V104"
            fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinejoin="round" filter="url(#fs-glow)" />
      <line x1="600" y1="180" x2="600" y2="760" stroke="#bfdbfe" strokeWidth="2" />
      <path d="M262 180V760" stroke="#93c5fd" strokeOpacity="0.6" strokeDasharray="4 5" />
      <path d="M254 180H270M254 760H270" stroke="#93c5fd" strokeOpacity="0.6" />
      <g className="fs-pulse" fill="#bfdbfe">
        <circle cx="300" cy="180" r="3.5" /><circle cx="600" cy="180" r="3.5" /><circle cx="740" cy="226" r="3.5" />
        <circle cx="740" cy="734" r="3.5" /><circle cx="300" cy="760" r="3.5" /><circle cx="600" cy="760" r="3.5" />
        <circle cx="470" cy="104" r="3" />
      </g>
      <path d="M300 578L250 520H232" fill="none" stroke="#fbbf24" strokeWidth="1.5" />
      <circle cx="300" cy="578" r="4.5" fill="#fbbf24" />
      <path d="M220 160V112H268M742 112H790V160M220 752V800H268M742 800H790V752"
            fill="none" stroke="#22d3ee" strokeWidth="2.5" strokeLinecap="round" />
      <g className="fs-scan">
        <rect x="220" y="-60" width="570" height="60" fill="url(#fs-scan-fill)" />
        <line x1="220" y1="0" x2="790" y2="0" stroke="#22d3ee" strokeWidth="2" filter="url(#fs-glow)" />
      </g>

      {/* AR labels */}
      <g fontFamily="Heebo, Assistant, system-ui, sans-serif" fontSize="13" textAnchor="middle">
        <rect x="220" y="66" width="224" height="30" rx="15" fill="#081430" fillOpacity="0.85" stroke="#22d3ee" strokeOpacity="0.45" />
        <circle cx="428" cy="81" r="4" fill="#22d3ee" />
        <text x="322" y="86" fill="#a5f3fc" direction="rtl">מצב AR · הבניין מעוגן לקרקע</text>
        <rect x="24" y="500" width="208" height="36" rx="10" fill="#081430" fillOpacity="0.88" stroke="#fbbf24" strokeOpacity="0.6" />
        <circle cx="214" cy="518" r="4" fill="#fbbf24" />
        <text x="120" y="523" fill="#fde68a" direction="rtl">קומה 3 · סיכון בינוני</text>
      </g>
    </svg>
  );
}
