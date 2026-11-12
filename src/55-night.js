/* ============================================================================
   NIGHT — light on the ground
   ----------------------------------------------------------------------------
   Emissive voxels alone give you a dark model with bright dots on it.  What
   makes a city at night is what the light falls on: warm pools under every
   streetlight, a smear of headlight on the asphalt, and the whole thing
   breathing in as the sun goes down.  All of it is one additive instanced
   quad layer — a single extra draw call.
   ============================================================================ */

const LAMPS = [];                 /* filled by streetLights() */
const spill = { mesh: null, cap: 0, nStatic: 0, nDyn: 0, opacity: 0 };

function _spillTexture() {
  const s = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0.00, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.22, 'rgba(255,255,255,0.60)');
  grad.addColorStop(0.52, 'rgba(255,255,255,0.22)');
  grad.addColorStop(0.78, 'rgba(255,255,255,0.06)');
  grad.addColorStop(1.00, 'rgba(255,255,255,0.0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(cv);
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

const _qFlat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
const _qSpin = new THREE.Quaternion();
const _q = new THREE.Quaternion();
const _m4 = new THREE.Matrix4();
const _v3 = new THREE.Vector3();
const _sc = new THREE.Vector3();
const _col = new THREE.Color();

function buildLightSpill() {
  const vehN = traffic.veh.length;
  /* subsample lamps so the layer stays one cheap draw call */
  const maxLamps = 2600;
  const step = Math.max(1, Math.ceil(LAMPS.length / maxLamps));
  const lamps = [];
  for (let i = 0; i < LAMPS.length; i += step) lamps.push(LAMPS[i]);
  const cap = lamps.length + vehN * 2;
  if (!cap) return;
  const mat = new THREE.MeshBasicMaterial({
    map: _spillTexture(), transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, opacity: 0, side: THREE.DoubleSide, fog: true,
  });
  const geo = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.InstancedMesh(geo, mat, cap);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  const y = (GROUND_H[2] || 0) + 0.10;
  for (let i = 0; i < lamps.length; i++) {
    const L = lamps[i];
    const r = L.r || rr(4.4, 6.6);
    _v3.set(L.x, y, L.z);
    _sc.set(r * 2, r * 2, 1);
    _m4.compose(_v3, _qFlat, _sc);
    mesh.setMatrixAt(i, _m4);
    _col.setHex(0xffb35e);
    const k = rr(0.75, 1.0);
    _col.multiplyScalar(k);
    mesh.setColorAt(i, _col);
  }
  /* park the dynamic instances out of sight until the first update */
  for (let i = lamps.length; i < cap; i++) {
    _v3.set(0, -400, 0); _sc.set(0.001, 0.001, 0.001);
    _m4.compose(_v3, _qFlat, _sc);
    mesh.setMatrixAt(i, _m4);
    mesh.setColorAt(i, _col.setHex(0xffffff));
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);
  spill.mesh = mesh;
  spill.cap = cap;
  spill.nStatic = lamps.length;
  spill.mat = mat;
}

function updateLightSpill(dt) {
  if (!spill.mesh) return;
  const level = NIGHT.level.value;
  spill.mat.opacity = 0.62 * level;
  spill.mesh.visible = level > 0.02;
  if (level <= 0.02) return;
  const y = (GROUND_H[2] || 0) + 0.11;
  let k = spill.nStatic;
  const veh = traffic.veh;
  for (let i = 0; i < veh.length && k + 1 < spill.cap; i++) {
    const v = veh[i];
    if (v.wx === undefined) continue;
    const V = VT[v.type];
    const cosR = Math.cos(v.rot), sinR = Math.sin(v.rot);
    /* headlight: a long warm smear ahead of the vehicle */
    _qSpin.setFromAxisAngle(new THREE.Vector3(0, 1, 0), v.rot);
    _q.copy(_qSpin).multiply(_qFlat);
    _v3.set(v.wx + cosR * V.len * 1.5, y, v.wz + sinR * V.len * 1.5);
    _sc.set(V.wid * 2.6, V.len * 3.4, 1);
    _m4.compose(_v3, _q, _sc);
    spill.mesh.setMatrixAt(k, _m4);
    spill.mesh.setColorAt(k, _col.setHex(0xffc078).multiplyScalar(0.55));
    k++;
    /* tail glow behind */
    _v3.set(v.wx - cosR * V.len * 0.7, y, v.wz - sinR * V.len * 0.7);
    _sc.set(V.wid * 1.9, V.len * 1.1, 1);
    _m4.compose(_v3, _q, _sc);
    spill.mesh.setMatrixAt(k, _m4);
    spill.mesh.setColorAt(k, _col.setHex(0xff5a3c).multiplyScalar(0.28));
    k++;
  }
  spill.nDyn = k - spill.nStatic;
  spill.mesh.instanceMatrix.needsUpdate = true;
  if (spill.mesh.instanceColor) spill.mesh.instanceColor.needsUpdate = true;
}
