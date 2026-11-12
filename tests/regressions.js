/* Focused logic regressions; run with node tests/regressions.js. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const readSource = (name) => fs.readFileSync(path.join(__dirname, '..', 'src', name), 'utf8');
const context = vm.createContext({
  assert,
  C: (value) => value,
  P: new Proxy({}, { get: () => [1, 1, 1] }),
  clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
  lerp: (a, b, t) => a + (b - a) * t,
  rnd: () => 0.5,
  asCol: (value) => value,
  GROUND_H: [0, 0, 0],
  R_LANE_W: 1,
  laneGraph: { atNode: {} },
});

vm.runInContext(readSource('50-life.js'), context);
vm.runInContext(`
  const oldEdge = { a: 1, b: 2, len: 10, lanes: 1, cls: 1,
    pts: [[0, 0], [10, 0]], road: { oneway: true } };
  const nextEdge = { a: 2, b: 3, len: 20, lanes: 1, cls: 1,
    pts: [[10, 0], [30, 0]], road: { oneway: true } };
  laneGraph.atNode[2] = [nextEdge];
  const vehicle = { e: oldEdge, s: 9.5, lane: 0, nL: 1,
    type: 'car', vmax: 2, spd: 2, col: [1, 1, 1] };
  traffic.veh = [vehicle];
  traffic.dyn = true;
  traffic.lit = traffic.glow = { set() {}, commit() {} };
  updateTraffic(0.5);
  assert.equal(vehicle.e, nextEdge, 'vehicle enters the connected edge');
  assert.equal(vehicle.s, 0.5, 'only overshoot carries into the new edge');
  assert.equal(vehicle.wx, 10.5, 'vehicle moves continuously through the junction');
`, context);

const main = readSource('90-main.js');
const toggleSource = main.slice(main.indexOf('function toggleTime()'), main.indexOf('ui.onTime ='));
assert.ok(toggleSource.startsWith('function toggleTime()'), 'time toggle exists');
vm.runInContext(`
  const TIME = { targetH: 9.4 };
  const state = { evening: false };
  const hud = { btnTime: { textContent: 'Evening',
    classList: { toggle(name, on) { this.on = on; } } } };
  ${toggleSource}
  toggleTime();
  assert.equal(TIME.targetH, 20.4, 'first Evening click selects evening');
  assert.equal(hud.btnTime.textContent, 'Daytime');
  assert.equal(hud.btnTime.classList.on, true);
  toggleTime();
  assert.equal(TIME.targetH, 9.4, 'second click returns to daytime');
  assert.equal(hud.btnTime.textContent, 'Evening');
  assert.equal(hud.btnTime.classList.on, false);
`, context);

console.log('PASS junction overshoot and Evening/Daytime toggle regressions');
