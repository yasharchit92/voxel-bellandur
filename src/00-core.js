/* ============================================================================
   VOXEL BELLANDUR — core
   ----------------------------------------------------------------------------
   A data-derived voxel diorama of Bellandur, Bengaluru.

   1 voxel unit = 4 m.  The whole city (3.26 x 2.88 km) is pushed into a pair of
   InstancedMeshes (one lit, one emissive) so ~200k boxes cost a handful of draw
   calls.  Geometry comes from OpenStreetMap via data/bellandur.geo.js; every
   height, colour and placement decision is made here, deterministically, from
   that geometry and a fixed seed.
   ============================================================================ */

/* ------------------------------- RNG + NOISE ------------------------------ */
const SEED = 20261111;
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const rnd = () => rng();
const rr = (a, b) => a + (b - a) * rng();
const ri = (a, b) => Math.floor(a + (b - a + 1) * rng());
const pick = (arr) => arr[(rng() * arr.length) | 0];
const chance = (p) => rng() < p;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

const perm = new Uint8Array(512);
(function () {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
})();
const h2 = (ix, iz) => perm[(perm[ix & 255] + (iz & 255)) & 255] / 255;
const sstep = (t) => t * t * t * (t * (t * 6 - 15) + 10);
function noise2(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = sstep(x - ix), fz = sstep(z - iz);
  const a = h2(ix, iz), b = h2(ix + 1, iz), c = h2(ix, iz + 1), d = h2(ix + 1, iz + 1);
  return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
}
function fbm(x, z, oct) {
  oct = oct || 3;
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { s += amp * noise2(x * f, z * f); norm += amp; amp *= 0.5; f *= 2.03; }
  return s / norm;
}

/* -------------------------------- COLOUR ---------------------------------- */
const C = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const asCol = (c) => {
  if (typeof c === 'number') return [c, c, c];
  if (!c) return [1, 0, 1];
  return typeof c[0] === 'number' ? c : (c[(rng() * c.length) | 0] || [1, 0, 1]);
};
const shadeC = (col, k) => { col = asCol(col); return [col[0] * k, col[1] * k, col[2] * k]; };
const jitC = (col, a) => {
  col = asCol(col);
  const j = 1 + (rng() * 2 - 1) * a;
  return [col[0] * j, col[1] * j, col[2] * j];
};
const mixC = (a, b, t) => {
  a = asCol(a); b = asCol(b);
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
};

/* --------------------------- BENGALURU PALETTE ---------------------------- */
const P = {
  // ground
  asphalt:  [C(0x3e3e43), C(0x45454a), C(0x3a3a3f), C(0x424247)],
  asphaltOld:[C(0x5b5a58), C(0x605f5b)],
  paving:   [C(0xb3ac9d), C(0xaba496), C(0xbdb6a7), C(0xa79f90)],
  earth:    [C(0xb0a48c), C(0xa89b83), C(0xbaae96), C(0xa2967e)],
  laterite: [C(0xa2735a), C(0x96684f), C(0xac7e63)],
  grass:    [C(0x6d9143), C(0x789c4c), C(0x61853c), C(0x84a355)],
  grassDk:  [C(0x53703a), C(0x4b6735)],
  scrub:    [C(0x94905f), C(0x8b8758), C(0x9d9a6b)],
  mud:      [C(0x9a8b6b), C(0x8f8062)],
  pitch:    [C(0x8a6f52), C(0x9c7f5e)],
  pool:     [C(0x74b6bd), C(0x68a9b2)],
  // built
  wallWarm: [C(0xdec9a4), C(0xd3bd94), C(0xe6d8bc), C(0xcbb392), C(0xd0ae78), C(0xd8c4a2)],
  wallPale: [C(0xe6ddc8), C(0xd8cfb8), C(0xeee6d2), C(0xcac0a6)],
  wallPink: [C(0xd0a98f), C(0xc49b80), C(0xdab79c), C(0xb98f74)],
  wallYellow:[C(0xd6be7c), C(0xcbb16c), C(0xdcc78c)],
  wallBlue: [C(0xa8b8bc), C(0x9aacb2)],
  wallGreen:[C(0xa8b79a), C(0x9aa98b), C(0xb6c2a8)],
  wallOchre:[C(0xc29a62), C(0xb58c56), C(0xcb9f6c)],
  concrete: [C(0xaeaaa0), C(0xa29e94), C(0xbab5a9)],
  concreteDk:[C(0x8b877e), C(0x817d76), C(0x969187)],
  glass:    [C(0x92aab4), C(0x84a0ac), C(0x9db3bb), C(0x7893a0), C(0xa9bcc0)],
  glassDk:  [C(0x647f8b), C(0x6f8b96)],
  glassGreen:[C(0x86a49a), C(0x92ad9f), C(0x7b9a8e)],
  roof:     [C(0xada68f), C(0xa09984), C(0xb8b09a), C(0x958e7b), C(0xb3a488), C(0x9fa08c)],
  roofTile: [C(0x9d6046), C(0x8a5038), C(0xab6d4e), C(0x7a4530)],
  roofBlue: [C(0x5f7488), C(0x6b8093), C(0x52667a)],
  tank:     [C(0x3a3a3e), C(0x44444a), C(0x2f2f33)],
  solar:    [C(0x2b3a52), C(0x334361)],
  white:    [C(0xf1efe6), C(0xe6e3d8)],
  // nature
  leaf:     [C(0x4a7433), C(0x3f682c), C(0x568238), C(0x365c26), C(0x608c3c)],
  leafDk:   [C(0x365227), C(0x3d5c2c)],
  leafLight:[C(0x66883f), C(0x718f47)],
  palm:     [C(0x5a7f39), C(0x638a3d)],
  trunk:    [C(0x6b5740), C(0x5f4d38), C(0x76614a)],
  reed:     [C(0x7d8b4c), C(0x8a9157), C(0x6f7d44)],
  water:    [C(0x5b7f74)],
  waterDk:  [C(0x3d5a52)],
  // traffic
  auto:     [C(0xc2c845), C(0xb8bf3f)],
  autoCanopy:[C(0x2c2c30), C(0x363639)],
  bus:      [C(0xe8e6dd), C(0xdfdcd0)],
  busBlue:  [C(0x2f5f9c), C(0x27538a)],
  car:      [C(0xdcdcd8), C(0xc9ccce), C(0x8f9498), C(0x4a4d52), C(0xa8392f), C(0x2f4a6b), C(0xd8d3c6)],
  taxi:     [C(0xefeee6), C(0xe7e5db)],
  truck:    [C(0xd6d2c4), C(0xc3bfb0), C(0xb5bcc0)],
  glassCar: [C(0x323c42), C(0x3b464c)],
  // construction / street
  orange:   [C(0xc8823a), C(0xd08a3e)],
  scaffold: [C(0xa89c88), C(0x9d917d)],
  tarp:     [C(0x3f6fa8), C(0x35608f)],
  steel:    [C(0x8d8a84), C(0x807d78)],
  pole:     [C(0x6e6a63), C(0x7a766e)],
  hoarding: [C(0xd8d3c4), C(0xc6c0b0)],
  glowWarm: [C(0xffcf8a), C(0xffc47a)],
  glowCool: [C(0xd8f0ff), C(0xc6e8ff)],
  glowRed:  [C(0xff6a4a)],
  glowGreen:[C(0x9cff8a)],
};

/* --------------------------- MATERIALS + PROGRAM -------------------------- */
const litMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

/* per-fragment grain so big flat surfaces (asphalt, footpaths, roofs) breathe
   without any texture file — derived from the instance colour + normal only. */
litMat.onBeforeCompile = (sh) => {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vGrain;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n' +
      'vGrain = (instanceMatrix * vec4(position, 1.0)).xyz;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vGrain;\n' +
      'float ghash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }')
    .replace('#include <color_fragment>', '#include <color_fragment>\n' +
      'float gn = ghash(floor(vGrain * 3.0) + floor(vGrain * 31.0) * 0.37);\n' +
      'diffuseColor.rgb *= 0.95 + gn * 0.10;');
};

/* water gets its own material: a depth tint, a grazing-angle sky reflection
   and a slow ripple, all computed from world position so no plate seams show  */
const waterU = { uTime: { value: 0 }, uSun: { value: new THREE.Vector3(0.66, 0.545, 0.518).normalize() } };
const waterMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
waterMat.onBeforeCompile = (sh) => {
  sh.uniforms.uTime = waterU.uTime;
  sh.uniforms.uSun = waterU.uSun;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWp;\nvarying vec3 vVd;')
    .replace('#include <project_vertex>',
      '#include <project_vertex>\nvWp = (instanceMatrix * vec4(position, 1.0)).xyz;\nvVd = normalize(-mvPosition.xyz);');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWp;\nvarying vec3 vVd;\nuniform float uTime;\nuniform vec3 uSun;\n' +
      'float hsh(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }\n' +
      'float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);\n' +
      '  return mix(mix(hsh(i),hsh(i+vec2(1.0,0.0)),f.x), mix(hsh(i+vec2(0.0,1.0)),hsh(i+vec2(1.0,1.0)),f.x), f.y); }')
    .replace('#include <color_fragment>', [
      '#include <color_fragment>',
      /* slow drifting ripples give the surface a normal to work with */
      'vec2 rp = vWp.xz * 0.42 + vec2(uTime * 0.030, uTime * 0.022);',
      'rp += vn(vWp.xz * 0.09 + vec2(uTime * 0.012, -uTime * 0.010)) * 2.4;',
      'float e = 0.35;',
      'float n0 = vn(rp), nx = vn(rp + vec2(e, 0.0)), nz = vn(rp + vec2(0.0, e));',
      'float n1 = vn(rp * 2.7 + 13.0), nx1 = vn(rp * 2.7 + vec2(e * 2.7, 0.0) + 13.0), nz1 = vn(rp * 2.7 + vec2(0.0, e * 2.7) + 13.0);',
      'vec3 N = normalize(vec3((n0 - nx) * 1.5 + (n1 - nx1) * 0.55, 1.0, (n0 - nz) * 1.5 + (n1 - nz1) * 0.55));',
      'vec3 V = normalize(cameraPosition - vWp);',
      
      /* depth tint from a second, larger noise */
      'float d = vn(vWp.xz * 0.028) * 0.66 + vn(vWp.xz * 0.095) * 0.34;',
      'vec3 shallowC = vec3(0.300, 0.455, 0.470);',
      'vec3 deepC    = vec3(0.120, 0.245, 0.290);',
      'vec3 wc = mix(shallowC, deepC, smoothstep(0.20, 0.88, d));',
      /* sky reflection at grazing angles: this is what makes it read as water */
      'float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.2);',
      'vec3 skyC = vec3(0.660, 0.780, 0.860);',
      'wc = mix(wc, skyC, clamp(fres * 1.25, 0.0, 0.90));',
      /* sun glitter on the ripple normals */
      'vec3 R = reflect(-V, N);',
      'float spec = pow(max(dot(R, normalize(uSun)), 0.0), 42.0);',
      'wc += vec3(1.0, 0.965, 0.895) * spec * 2.2;',
      'float spec2 = pow(max(dot(R, normalize(uSun)), 0.0), 8.0);',
      'wc += vec3(0.95, 0.90, 0.82) * spec2 * 0.07;',
      'diffuseColor.rgb = wc;',
    ].join('\n'));
};

/* --------------------------- INSTANCED BOX BUILDER ------------------------ */
class Builder {
  constructor(withAO) {
    this.px = []; this.py = []; this.pz = [];
    this.sx = []; this.sy = []; this.sz = [];
    this.cr = []; this.cg = []; this.cb = [];
    this.rot = [];
    this.n = 0;
    this.ao = withAO !== false;
    this.grid = this.ao ? new Map() : null;
  }
  raw(x, y, z, sx, sy, sz, col) {
    if (!(col[0] >= 0) || !(col[1] >= 0) || !(col[2] >= 0)) col = [1, 0, 1];
    this.px.push(x); this.py.push(y); this.pz.push(z);
    this.sx.push(sx); this.sy.push(sy); this.sz.push(sz);
    this.cr.push(col[0]); this.cg.push(col[1]); this.cb.push(col[2]);
    this.rot.push(0);
    this.n++;
    return this;
  }
  v(gx, gy, gz, col, sx, sy, sz) {
    sx = sx === undefined ? 1 : sx; sy = sy === undefined ? 1 : sy; sz = sz === undefined ? 1 : sz;
    this.raw(gx + 0.5, gy + 0.5, gz + 0.5, sx, sy, sz, jitC(col, 0.045));
    if (this.grid && sx === 1 && sy === 1 && sz === 1) this.grid.set(vkey(gx, gy, gz), this.n - 1);
    return this;
  }
  vc(gx, gy, gz, col, sx, sy, sz) {
    sx = sx === undefined ? 1 : sx; sy = sy === undefined ? 1 : sy; sz = sz === undefined ? 1 : sz;
    this.raw(gx + 0.5, gy + 0.5, gz + 0.5, sx, sy, sz, col);
    if (this.grid && sx === 1 && sy === 1 && sz === 1) this.grid.set(vkey(gx, gy, gz), this.n - 1);
    return this;
  }
  /* one axis-aligned block spanning [x0,x1] x [y0,y1] x [z0,z1] — 1 instance */
  blk(x0, x1, y0, y1, z0, z1, col) {
    const w = x1 - x0, h = y1 - y0, d = z1 - z0;
    if (w <= 0 || h <= 0 || d <= 0) return this;
    return this.raw((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, w, h, d, asCol(col));
  }
  box(x0, x1, y0, y1, z0, z1, col, jit) {
    jit = jit === undefined ? 0.045 : jit;
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++) this.v(x, y, z, jitC(col, jit));
    return this;
  }
  shell(x0, x1, y0, y1, z0, z1, col) {
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++)
          if (x === x0 || x === x1 || y === y0 || y === y1 || z === z0 || z === z1) this.v(x, y, z, jitC(col, 0.05));
    return this;
  }
  computeAO() {
    if (!this.grid) return;
    const g = this.grid;
    this.aoV = new Float32Array(this.n).fill(1);
    g.forEach((idx, key) => {
      const y = (key % KEYSPAN) - KEYOFF;
      const t = (key - (y + KEYOFF)) / KEYSPAN;
      const z = (t % KEYSPAN) - KEYOFF;
      const x = ((t - (z + KEYOFF)) / KEYSPAN) - KEYOFF;
      let occ = 0;
      if (g.has(vkey(x + 1, y, z))) occ++;
      if (g.has(vkey(x - 1, y, z))) occ++;
      if (g.has(vkey(x, y + 1, z))) occ++;
      if (g.has(vkey(x, y - 1, z))) occ++;
      if (g.has(vkey(x, y, z + 1))) occ++;
      if (g.has(vkey(x, y, z - 1))) occ++;
      this.aoV[idx] = 1 - occ * 0.05;
    });
  }
  build(material, opts) {
    opts = opts || {};
    this.computeAO();
    const n = this.n;
    if (!n) return null;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.InstancedMesh(geo, material, n);
    mesh.instanceMatrix.setUsage(opts.dynamic ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage);
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    const sv = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      sv.set(this.sx[i], this.sy[i], this.sz[i]);
      if (this.rot[i]) { m.makeRotationY(this.rot[i]); m.scale(sv); }
      else { m.makeScale(sv.x, sv.y, sv.z); }
      m.setPosition(this.px[i], this.py[i], this.pz[i]);
      mesh.setMatrixAt(i, m);
      const k = this.aoV ? this.aoV[i] : 1;
      col.setRGB(this.cr[i] * k, this.cg[i] * k, this.cb[i] * k);
      mesh.setColorAt(i, col);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = opts.cast !== false;
    mesh.receiveShadow = opts.receive !== false;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
  }
}
const KEYOFF = 2000, KEYSPAN = 6000;
const vkey = (x, y, z) => ((x + KEYOFF) * KEYSPAN + (z + KEYOFF)) * KEYSPAN + (y + KEYOFF);

/* -------------------------------- RENDERER -------------------------------- */
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.LinearEncoding;
renderer.toneMapping = THREE.NoToneMapping;
renderer.setClearColor(0xdfe9ec, 1);
renderer.info.autoReset = false;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xd9e2e2, 900, 2600);

/* world extents (voxel units) — filled from the geo bundle at boot */
const W = { ox: -407, oz: -360, w: 815, h: 720 };
function applyGeoMeta(meta) {
  W.ox = meta.local.x[0]; W.oz = meta.local.z[0];
  W.w = meta.grid[0]; W.h = meta.grid[1];
}
/* grid cell -> world centre (cell (i,j) with size (w,d)) */
const cx = (i, w) => W.ox + i + w / 2;
const cz = (j, d) => W.oz + j + d / 2;

const camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 1.2, 6000);
const HOME_POS = new THREE.Vector3(300, 315, 640);
const HOME_TARGET = new THREE.Vector3(20, 0, 30);
camera.position.copy(HOME_POS);
camera.lookAt(HOME_TARGET);

/* --------------------------------- SKY ----------------------------------- */
const skyU = {
  cTop: { value: new THREE.Color(0x2f74bd) },
  cMid: { value: new THREE.Color(0x9dc9dd) },
  cBot: { value: new THREE.Color(0xd8d2c2) },
  sunDir: { value: new THREE.Vector3(0.66, 0.545, 0.518).normalize() },
};
(function makeSky() {
  const geo = new THREE.SphereGeometry(3000, 32, 20);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: skyU,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: [
      'varying vec3 vDir; uniform vec3 cTop, cMid, cBot, sunDir;',
      'void main(){',
      '  float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);',
      '  vec3 col = mix(cBot, cMid, smoothstep(0.44, 0.63, h));',
      '  col = mix(col, cTop, smoothstep(0.60, 0.99, h));',
      '  float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);',
      '  col += vec3(1.0, 0.93, 0.76) * pow(s, 24.0) * 0.42;',
      '  col += vec3(1.0, 0.95, 0.84) * pow(s, 3.0) * 0.09;',
      '  gl_FragColor = vec4(col, 1.0);',
      '}'].join('\n'),
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);
})();

/* -------------------------------- LIGHTS --------------------------------- */
const hemi = new THREE.HemisphereLight(0xd6e2ea, 0x8a6f4a, 0.33);
scene.add(hemi);
const ambient = new THREE.AmbientLight(0xffffff, 0.08);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xffeccb, 0.76);
const SUN_DIR = new THREE.Vector3(0.66, 0.545, 0.518).normalize();
sun.position.copy(SUN_DIR).multiplyScalar(600);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.near = 40;
sun.shadow.camera.far = 1500;
const SHADOW_SPAN = 230;                       /* follows the camera focus */
sun.shadow.camera.left = -SHADOW_SPAN; sun.shadow.camera.right = SHADOW_SPAN;
sun.shadow.camera.top = SHADOW_SPAN; sun.shadow.camera.bottom = -SHADOW_SPAN;
sun.shadow.bias = -0.00035;
sun.shadow.normalBias = 0.85;
sun.shadow.radius = 1.2;
scene.add(sun);
scene.add(sun.target);

/* ------------------------------ POST PROCESSING -------------------------- */
let composer = null, bloomPass = null, bloomOn = true;
function setupComposer() {
  if (!THREE.EffectComposer || !THREE.UnrealBloomPass) return;
  try {
    const rt = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
      type: THREE.HalfFloatType, samples: 4,
    });
    composer = new THREE.EffectComposer(renderer, rt);
    composer.addPass(new THREE.RenderPass(scene, camera));
    bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.26, 0.45, 1.0);
    composer.addPass(bloomPass);
  } catch (e) {
    console.warn('Bloom unavailable, falling back to direct render.', e);
    composer = null;
  }
}

/* --------------------------- SHARED GLOW SPRITES ------------------------- */
const glowTex = (function () {
  const s = 128, cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.22, 'rgba(255,255,255,0.70)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.18)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(cv);
  t.needsUpdate = true;
  return t;
})();
const glowSprites = [];
function addGlow(x, y, z, size, color, opacity) {
  const mat = new THREE.SpriteMaterial({
    map: glowTex, color: color, transparent: true,
    opacity: opacity === undefined ? 0.55 : opacity,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const s = new THREE.Sprite(mat);
  s.position.set(x, y, z);
  s.scale.setScalar(size);
  scene.add(s);
  glowSprites.push(s);
  return s;
}

/* ----------------------------- GLOBAL BUILDERS --------------------------- */
const vb = new Builder(true);    /* lit voxels */
const vg = new Builder(false);   /* emissive voxels (lit windows, lamps) */
const vw = new Builder(false);   /* water surface */
const anim = [];                 /* per-frame updaters            */
const ui = { labels: [], showLabels: false };

/* ------------------------------- DAY / NIGHT ----------------------------- */
const TIME = {
  t: 0,                          /* 0 = late afternoon, 1 = evening */
  target: 0,
  day: {
    sunDir: new THREE.Vector3(0.66, 0.545, 0.518).normalize(),
    sunCol: new THREE.Color(0xffeecf), sunInt: 0.90,
    hemiSky: new THREE.Color(0xcfe4f2), hemiGnd: new THREE.Color(0x775f3f), hemiInt: 0.33,
    ambInt: 0.08,
    skyTop: new THREE.Color(0x2f74bd), skyMid: new THREE.Color(0x9ec2d6), skyBot: new THREE.Color(0xd8d2c2),
    fog: new THREE.Color(0xd0d4cc), fogNear: 1050, fogFar: 2900,
    clear: new THREE.Color(0xd2d6d0),
  },
  eve: {
    sunDir: new THREE.Vector3(0.58, 0.075, 0.81).normalize(),
    sunCol: new THREE.Color(0xffa869), sunInt: 0.34,
    hemiSky: new THREE.Color(0x5a6a94), hemiGnd: new THREE.Color(0x342a26), hemiInt: 0.20,
    ambInt: 0.075,
    skyTop: new THREE.Color(0x16294f), skyMid: new THREE.Color(0xb06a4e), skyBot: new THREE.Color(0xe8a878),
    fog: new THREE.Color(0x9c7e70), fogNear: 560, fogFar: 2000,
    clear: new THREE.Color(0x9c7e70),
  },
};
function applyTime(t) {
  TIME.t = t;
  const a = TIME.day, b = TIME.eve;
  sun.position.copy(a.sunDir.clone().lerp(b.sunDir, t)).normalize().multiplyScalar(600);
  skyU.sunDir.value.copy(sun.position).normalize();
  waterU.uSun.value.copy(skyU.sunDir.value);
  sun.color.copy(a.sunCol).lerp(b.sunCol, t);
  sun.intensity = lerp(a.sunInt, b.sunInt, t);
  hemi.color.copy(a.hemiSky).lerp(b.hemiSky, t);
  hemi.groundColor.copy(a.hemiGnd).lerp(b.hemiGnd, t);
  hemi.intensity = lerp(a.hemiInt, b.hemiInt, t);
  ambient.intensity = lerp(a.ambInt, b.ambInt, t);
  skyU.cTop.value.copy(a.skyTop).lerp(b.skyTop, t);
  skyU.cMid.value.copy(a.skyMid).lerp(b.skyMid, t);
  skyU.cBot.value.copy(a.skyBot).lerp(b.skyBot, t);
  scene.fog.color.copy(a.fog).lerp(b.fog, t);
  scene.fog.near = lerp(a.fogNear, b.fogNear, t);
  scene.fog.far = lerp(a.fogFar, b.fogFar, t);
  renderer.setClearColor(a.clear.clone().lerp(b.clear, t), 1);
  if (bloomPass) { bloomPass.strength = lerp(0.26, 0.80, t); bloomPass.threshold = lerp(1.0, 0.74, t); }
  if (vg.mesh) vg.mesh.visible = t > 0.02;
  for (let i = 0; i < glowSprites.length; i++) glowSprites[i].visible = t > 0.05;
  if (ui.onTime) ui.onTime(t);
}
