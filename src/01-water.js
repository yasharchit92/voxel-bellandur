/* ============================================================================
   WATER
   ----------------------------------------------------------------------------
   The lake is 1.5 km2 of the frame, so it gets a real shader: two drifting
   ripple octaves plus a travelling gust give it a normal; a sky-gradient
   reflection with proper Fresnel makes it mirror the actual sky; a blurred
   lake mask grows silt, weed and a foam band along the OSM shoreline; and a
   narrow specular lobe scatters the sun into a glitter path.
   ============================================================================ */

const waterU = {
  uTime: { value: 0 },
  uSun: { value: new THREE.Vector3(0.66, 0.545, 0.518).normalize() },
  uSunI: { value: 1.0 },
  uLight: { value: 1.0 },
  uMask: { value: null },
  uBox: { value: new THREE.Vector4(0, 0, 1, 1) },
};

/* the water is self-lit: the shader models sun + sky + depth itself, so it must
   not be multiplied by the scene lights (a Lambert water goes black at dusk,
   which is the opposite of what dusk does to a lake) */
const waterMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
waterMat.onBeforeCompile = (sh) => {
  sh.uniforms.uTime = waterU.uTime;
  sh.uniforms.uSun = waterU.uSun;
  sh.uniforms.uSunI = waterU.uSunI;
  sh.uniforms.uLight = waterU.uLight;
  sh.uniforms.uMask = waterU.uMask;
  sh.uniforms.uBox = waterU.uBox;
  sh.uniforms.cTop = skyU.cTop;
  sh.uniforms.cMid = skyU.cMid;
  sh.uniforms.cBot = skyU.cBot;
  sh.uniforms.uNight = skyU.uNight;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWp;\nvarying vec3 vVd;')
    .replace('#include <project_vertex>',
      '#include <project_vertex>\nvWp = (instanceMatrix * vec4(position, 1.0)).xyz;\nvVd = normalize(-mvPosition.xyz);');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWp;\nvarying vec3 vVd;\n' +
      'uniform float uTime; uniform float uSunI; uniform float uLight; uniform vec3 uSun;\n' +
      'uniform vec3 cTop; uniform vec3 cMid; uniform vec3 cBot; uniform float uNight;\n' +
      'uniform sampler2D uMask; uniform vec4 uBox;\n' +
      'float hsh(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }\n' +
      'float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);\n' +
      '  return mix(mix(hsh(i),hsh(i+vec2(1.0,0.0)),f.x), mix(hsh(i+vec2(0.0,1.0)),hsh(i+vec2(1.0,1.0)),f.x), f.y); }\n' +
      'vec3 skyAt(vec3 d){\n' +
      '  float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);\n' +
      '  vec3 c = mix(cBot, cMid, smoothstep(0.44, 0.63, h));\n' +
      '  return mix(c, cTop, smoothstep(0.60, 0.99, h));\n' +
      '}')
    .replace('#include <color_fragment>', [
      '#include <color_fragment>',
      /* ---- ripples: two low-frequency octaves drive the reflection (smooth,
         so it never speckles at distance) and a fine octave drives the glitter */
      'vec2 rp = vWp.xz * 0.30 + vec2(uTime * 0.024, uTime * 0.017);',
      'rp += vn(vWp.xz * 0.07 + vec2(uTime * 0.010, -uTime * 0.008)) * 2.2;',
      'float gust = 0.6 + 0.4 * sin(dot(vWp.xz, vec2(0.016, 0.010)) - uTime * 0.30);',
      'float e = 0.5;',
      'float n0 = vn(rp), nx = vn(rp + vec2(e, 0.0)), nz = vn(rp + vec2(0.0, e));',
      'float n1 = vn(rp * 2.3 + 13.0), nx1 = vn(rp * 2.3 + vec2(e * 2.3, 0.0) + 13.0), nz1 = vn(rp * 2.3 + vec2(0.0, e * 2.3) + 13.0);',
      'float n2 = vn(rp * 6.4 - 4.0), nx2 = vn(rp * 6.4 + vec2(e * 6.4, 0.0) - 4.0), nz2 = vn(rp * 6.4 + vec2(0.0, e * 6.4) - 4.0);',
      'vec3 Nl = normalize(vec3(((n0 - nx) * 0.62 + (n1 - nx1) * 0.26) * gust, 1.7,',
      '                          ((n0 - nz) * 0.62 + (n1 - nz1) * 0.26) * gust));',
      'vec3 Nd = normalize(vec3((n2 - nx2) * 0.55, 1.0, (n2 - nz2) * 0.55));',
      'vec3 V = normalize(cameraPosition - vWp);',
      'float camDist = length(cameraPosition - vWp);',
      'float fade = clamp(1.0 - camDist / 620.0, 0.06, 1.0);',
      'vec3 Nref = normalize(mix(vec3(0.0, 1.0, 0.0), Nl, fade));',
      'vec3 Nglit = normalize(Nref + (Nd - vec3(0.0, 1.0, 0.0)) * 0.85 * fade);',

      /* ---- water body: turbid shallows, deep middle ---- */
      'float d = vn(vWp.xz * 0.028) * 0.66 + vn(vWp.xz * 0.095) * 0.34;',
      'vec3 shallowC = vec3(0.255, 0.370, 0.335);',
      'vec3 deepC    = vec3(0.075, 0.175, 0.215);',
      'vec3 wc = mix(shallowC, deepC, smoothstep(0.20, 0.88, d)) * (0.16 + 0.92 * uLight);',

      /* ---- shoreline: silt, weed and foam from the blurred lake mask ---- */
      'vec2 muv = (vWp.xz - uBox.xy) / uBox.zw;',
      'float m = texture2D(uMask, muv).r;',
      'float shore = smoothstep(0.18, 0.55, m) * (1.0 - smoothstep(0.55, 0.80, m));',
      'wc = mix(wc, vec3(0.215, 0.255, 0.180) * (0.20 + 0.85 * uLight), shore * 0.75);',
      'float foamN = vn(vWp.xz * 1.6 + vec2(uTime * 0.05, -uTime * 0.04));',
      'float foam = smoothstep(0.34, 0.05, m) * smoothstep(0.35, 0.75, foamN + 0.25) * 0.9;',
      'wc += vec3(0.50, 0.52, 0.47) * foam * (0.20 + 0.80 * uLight);',

      /* ---- sky reflection ---- */
      'vec3 R = reflect(-V, Nref);',
      'float fres = 0.03 + 0.97 * pow(1.0 - clamp(dot(Nref, V), 0.0, 1.0), 5.0);',
      'vec3 skyRefl = skyAt(R) * vec3(0.90, 0.965, 1.0);',
      'wc = mix(wc, skyRefl, clamp(fres * 0.86, 0.0, 0.78));',

      /* ---- sun glitter: a tight lobe on the fine ripples ---- */
      'vec3 L = normalize(uSun);',
      'vec3 Rg = reflect(-V, Nglit);',
      'float sd = max(dot(Rg, L), 0.0);',
      'float glint = pow(sd, 300.0) * 2.4 + pow(sd, 70.0) * 0.14 + pow(sd, 14.0) * 0.02;',
      'float sparkle = smoothstep(0.45, 0.95, vn(vWp.xz * 2.6 + vec2(uTime * 0.35, uTime * 0.28)));',
      'wc += vec3(1.0, 0.94, 0.83) * glint * uSunI * (0.30 + 0.70 * sparkle) * step(0.0, L.y) * fade;',
      'wc += vec3(0.55, 0.42, 0.28) * shore * uSunI * 0.10;',
      /* --- at night the shoreline picks up the city's own light --- */
      'wc += vec3(0.62, 0.44, 0.24) * shore * uNight * 0.42;',
      'diffuseColor.rgb = wc;',
      ].join('\n'));
};
