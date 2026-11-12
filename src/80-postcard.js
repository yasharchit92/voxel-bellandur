/* ============================================================================
   POSTCARD — a shareable still, rendered at 2x and captioned
   ============================================================================ */

function renderStill(scale) {
  const W0 = window.innerWidth, H0 = window.innerHeight;
  const w = Math.round(W0 * scale), h = Math.round(H0 * scale);
  const prevPR = renderer.getPixelRatio();
  const wasBloom = state.bloomOn;
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  if (composer) composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  /* one clean frame */
  if (composer && wasBloom) composer.render();
  else renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  renderer.setPixelRatio(prevPR);
  renderer.setSize(W0, H0, false);
  if (composer) composer.setSize(W0, H0);
  camera.aspect = W0 / H0;
  camera.updateProjectionMatrix();
  return url;
}

function postcardDataURL(scale) {
  scale = scale || 2;
  const shot = renderStill(scale);
  const img = new Image();
  /* synchronous canvas composition needs the image decoded; use the data URL
     directly as a background fill via a 2D context drawImage after decode */
  const cv = document.createElement('canvas');
  const W = Math.round(window.innerWidth * scale), H = Math.round(window.innerHeight * scale);
  const bar = Math.round(H * 0.085);
  cv.width = W; cv.height = H + bar;
  const g = cv.getContext('2d');
  g.fillStyle = '#14110e';
  g.fillRect(0, 0, cv.width, cv.height);
  try {
    g.drawImage(window.__cardImg, 0, 0, W, H);
  } catch (e) {
    g.fillStyle = '#14110e'; g.fillRect(0, 0, W, H);
  }
  /* caption plate */
  const pad = Math.round(bar * 0.42);
  g.fillStyle = '#f3e9d6';
  g.font = `600 ${Math.round(bar * 0.30)}px "Helvetica Neue", Arial, sans-serif`;
  g.fillText('VOXEL BELLANDUR', pad, H + bar * 0.52);
  g.fillStyle = '#a89b87';
  g.font = `400 ${Math.round(bar * 0.20)}px "Helvetica Neue", Arial, sans-serif`;
  const hh = Math.floor(TIME.h), mm = Math.round((TIME.h - hh) * 60);
  const cap = `Bellandur Lake · Outer Ring Road · 3.26 x 2.88 km · 4 m voxels · ${String(hh).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')} · ${TIME.h > 6 && TIME.h < 18 ? 'day' : 'after dusk'}`;
  g.fillText(cap, pad, H + bar * 0.82);
  g.fillStyle = '#6ee0c8';
  g.font = `600 ${Math.round(bar * 0.19)}px "Helvetica Neue", Arial, sans-serif`;
  g.textAlign = 'right';
  g.fillText('© OpenStreetMap contributors · ODbL 1.0', cv.width - pad, H + bar * 0.52);
  g.fillStyle = '#8b8073';
  g.font = `400 ${Math.round(bar * 0.18)}px "Helvetica Neue", Arial, sans-serif`;
  g.fillText('SEED ' + SEED + ' · 2026-11-11', cv.width - pad, H + bar * 0.82);
  return { url: cv.toDataURL('image/png'), shot: shot };
}

function savePostcard(scale) {
  const out = postcardDataURL(scale);
  const a = document.createElement('a');
  a.href = out.url;
  a.download = 'voxel-bellandur.png';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 0);
  return out.url;
}

/* the raw render is decoded into an <img> the composition step can draw */
function prepareCardImage(scale) {
  return new Promise((resolve) => {
    const url = renderStill(scale || 2);
    const img = new Image();
    img.onload = () => { window.__cardImg = img; resolve(url); };
    img.onerror = () => { window.__cardImg = null; resolve(url); };
    img.src = url;
  });
}
