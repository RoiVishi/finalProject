/**
 * Real construction projects (sourced from ArchDaily) expressed as parametric
 * building specs — this is the data the future "upload photos/blueprints"
 * pipeline would extract automatically. The Digital Twin renders any spec.
 *
 * widthFactor(f): per-floor facade width multiplier (1 = full base width),
 * used for terraced setbacks like the Arcades tower.
 */
export const PROJECTS = [
  {
    id: 'podun',
    name: 'Podun — ברטיסלבה',
    architect: 'Kuklica x Smerek Architekti (2024)',
    source: 'https://www.archdaily.com/1025536/podun-apartment-building-kuklica-x-smerek-architekti',
    photo:
      'https://images.adsttc.com/media/images/6780/2ce7/7ace/9501/886f/5362/medium_jpg/podun-apartment-building-kuklica-x-smerek-architekti_19.jpg',
    plan: 'https://images.adsttc.com/media/images/6780/2ca2/4bc3/6d01/879d/587d/medium_jpg/1st-fp-1.jpg',
    floors: 5,
    floorHeight: 1.7,
    baseWidth: 8.6,
    depth: 3.8,
    style: 'concrete',
    windows: 'punched',
    facadeColor: '#b7bcc2',
    slabColor: '#cfd4da',
    windowColor: '#3d5a6e',
    balconies: 'recessed',
    widthFactor: () => 1,
    // AI-generated GLB (Higgsfield image-to-3D from the real photo).
    // Download with: bash scripts/fetch_models.sh
    model: true,
  },
  {
    id: 'baal-haakeda',
    name: 'בעל העקדה 5 — תל אביב',
    architect: 'Toam Architecture',
    source: 'https://www.archdaily.com/896672/baal-haakeda-5-tel-aviv-toam-architecture',
    photo:
      'https://images.adsttc.com/media/images/5b28/ff4e/f197/cce0/d700/0091/medium_jpg/DSC_5179-Pano.jpg',
    plan: 'https://images.adsttc.com/media/images/5b28/fdd9/f197/ccd2/6200/01a5/medium_jpg/ground_floor.jpg',
    floors: 4,
    floorHeight: 1.8,
    baseWidth: 9.5,
    depth: 4.2,
    style: 'concrete',
    windows: 'ribbon',
    facadeColor: '#e8e4dc',
    slabColor: '#efece6',
    windowColor: '#2f3e46',
    balconies: 'none',
    widthFactor: () => 1,
  },
  {
    id: 'tlv-arcades',
    name: 'Tel Aviv Arcades — מגדל',
    architect: 'Penda (18 קומות, לבנים)',
    source: 'https://www.archdaily.com/896854/cascading-brick-arches-feature-in-pendas-residential-tower-in-tel-aviv',
    photo:
      'https://images.adsttc.com/media/images/5b2b/ca58/f197/ccb7/6c00/038a/medium_jpg/TelAviv_Arcades_by_penda.jpg',
    plan: 'https://images.adsttc.com/media/images/5b2b/c967/f197/cc81/8600/020d/medium_jpg/TelAviv_Arcades_IMG_(3).jpg',
    floors: 18,
    floorHeight: 1.55,
    baseWidth: 11,
    depth: 5,
    style: 'brick',
    facadeColor: '#b3714f',
    slabColor: '#c9a88f',
    windowColor: '#40342c',
    balconies: 'terraces',
    // cascading setbacks: full width up to floor 9, then step in
    widthFactor: (f) => (f < 9 ? 1 : Math.max(0.45, 1 - (f - 8) * 0.055)),
  },
];
