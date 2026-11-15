/**
 * Build a trail's centreline and elevation profile into the asset the island loads.
 *
 * Four stages, each of which failed in an instructive way the first time:
 *
 * 1. FETCH. The trail is an OSM superroute: a relation of per-state relations of ways. Overpass
 *    gives the members and the geometry; both are cached on disk because the geometry is 13 MB
 *    and nobody should re-download it to re-tune a tolerance.
 *
 * 2. CHAIN. Do NOT trust member order. The Appalachian Trail's relation carries a note asking
 *    editors to keep it sorted northbound, and it mostly is, but Virginia's 312 ways are not:
 *    following the stated order produced 2,835 miles with two 447 km leaps, because the line
 *    jumped north, walked back down the state and jumped north again. Chaining on shared node
 *    ids instead, from the terminus node the relation itself names, and using member order only
 *    to break ties at junctions, gives one unbroken line with nothing left over.
 *
 * 3. SIMPLIFY. Douglas-Peucker at a tolerance chosen to match the DEM, not to look tidy. The
 *    elevations come from a 90 m model, so points much closer than that resample one cell.
 *
 * 4. ELEVATE. Open-Meteo's elevation endpoint, which takes at most 100 coordinates per call.
 *
 * Licensing, which is not optional: the centreline is a Derivative Database of OpenStreetMap
 * under ODbL 1.0, and the elevations are Open-Meteo's under CC BY 4.0. Both notices travel
 * inside the emitted asset so they cannot be separated from the data by accident.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const UA = 'will-i-be-cold trail builder (https://github.com/alexr314/backpacking-science)';
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

/** The trails this tool knows how to build. `start` is the OSM node at the end you measure from. */
const TRAILS = {
  'appalachian-trail': { relation: 156553, start: 295437171, name: 'Appalachian Trail', from: 'Springer Mountain, Georgia', to: 'Katahdin, Maine' },
};

const R_EARTH = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
function haversine(a, b) {
  const p1 = rad(a[1]);
  const p2 = rad(b[1]);
  const dp = p2 - p1;
  const dl = rad(b[0] - a[0]);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}
const lengthOf = (ps) => ps.reduce((t, p, i) => (i === 0 ? 0 : t + haversine(ps[i - 1], p)), 0);

async function overpass(query, cacheFile) {
  if (cacheFile && existsSync(cacheFile)) {
    process.stderr.write(`   cached ${path.basename(cacheFile)}\n`);
    return JSON.parse(await readFile(cacheFile, 'utf8'));
  }
  // Overpass answers a query this heavy out of a work queue, so a 502 or 504 means "busy", not
  // "wrong". Rotate the mirrors and back off; giving up on the first refusal is why the first
  // run of this died after downloading nothing.
  let lastErr;
  for (let round = 0; round < 4; round += 1) {
    for (const url of MIRRORS) {
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ data: query }) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const json = JSON.parse(text);
        if (cacheFile) await writeFile(cacheFile, text);
        return json;
      } catch (err) {
        lastErr = err;
        process.stderr.write(`   ${new URL(url).host} ${err.message}\n`);
      }
    }
    const wait = 15000 * 2 ** round;
    process.stderr.write(`   all mirrors busy, waiting ${wait / 1000}s\n`);
    await new Promise((r) => setTimeout(r, wait));
  }
  throw lastErr;
}

/** Stage 2: one unbroken line, by connectivity, starting from the named terminus node. */
function chain(members, geometry, startNode) {
  const rels = new Map(members.elements.filter((e) => e.type === 'relation').map((e) => [e.id, e]));
  const ways = new Map(geometry.elements.filter((e) => e.type === 'way').map((e) => [e.id, e]));
  const top = [...rels.values()].find((r) => r.members.some((m) => m.type === 'relation')) ?? [...rels.values()][0];

  const order = [];
  for (const m of top.members) {
    if (m.type === 'way' && !['approach', 'alternative'].includes(m.role ?? '')) order.push(m.ref);
    else if (m.type === 'relation' && rels.has(m.ref)) {
      for (const sm of rels.get(m.ref).members) {
        if (sm.type === 'way' && !['approach', 'alternative'].includes(sm.role ?? '')) order.push(sm.ref);
      }
    }
  }
  const rank = new Map();
  order.forEach((w, i) => { if (!rank.has(w)) rank.set(w, i); });
  const pool = order.filter((w) => ways.has(w) && (ways.get(w).nodes ?? []).length >= 2);

  const ends = new Map();
  const add = (n, w) => ends.set(n, [...(ends.get(n) ?? []), w]);
  for (const w of pool) { const n = ways.get(w).nodes; add(n[0], w); add(n[n.length - 1], w); }

  const used = new Set();
  let line = [];
  let node = startNode;
  for (;;) {
    const next = (ends.get(node) ?? []).filter((w) => !used.has(w));
    if (next.length === 0) break;
    const w = next.reduce((a, b) => (rank.get(b) < rank.get(a) ? b : a));
    let nodes = ways.get(w).nodes;
    let pts = ways.get(w).geometry.map((p) => [p.lon, p.lat]);
    if (nodes[nodes.length - 1] === node) { nodes = [...nodes].reverse(); pts = pts.reverse(); }
    used.add(w);
    line = line.length === 0 ? pts : line.concat(pts.slice(1));
    node = nodes[nodes.length - 1];
  }
  return { line, chained: used.size, pool: pool.length };
}

/** Stage 3: Douglas-Peucker, in metres, iterative so a 190k-point line cannot blow the stack. */
function simplify(ps, tolerance) {
  const keep = new Array(ps.length).fill(false);
  keep[0] = keep[ps.length - 1] = true;
  const mx = 111320 * Math.cos(rad(ps[0][1]));
  const my = 110540;
  const stack = [[0, ps.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop();
    if (b <= a + 1) continue;
    const ax = ps[a][0] * mx;
    const ay = ps[a][1] * my;
    const bx = ps[b][0] * mx;
    const by = ps[b][1] * my;
    const dx = bx - ax;
    const dy = by - ay;
    const den = Math.hypot(dx, dy) || 1;
    let best = -1;
    let bi = -1;
    for (let i = a + 1; i < b; i += 1) {
      const d = Math.abs(dy * ps[i][0] * mx - dx * ps[i][1] * my + bx * ay - by * ax) / den;
      if (d > best) { best = d; bi = i; }
    }
    if (best > tolerance) { keep[bi] = true; stack.push([a, bi], [bi, b]); }
  }
  return ps.filter((_, i) => keep[i]);
}

/** Stage 4: elevations, 100 at a time, politely. */
async function elevations(points, onProgress) {
  const out = [];
  for (let i = 0; i < points.length; i += 100) {
    const batch = points.slice(i, i + 100);
    const lat = batch.map((p) => p[1].toFixed(5)).join(',');
    const lon = batch.map((p) => p[0].toFixed(5)).join(',');
    let got = null;
    for (let attempt = 0; attempt < 5 && got === null; attempt += 1) {
      try {
        const res = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`, { headers: { 'User-Agent': UA } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!Array.isArray(json.elevation) || json.elevation.length !== batch.length) throw new Error('shape');
        got = json.elevation;
      } catch {
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      }
    }
    if (got === null) throw new Error(`elevation failed at point ${i}`);
    out.push(...got);
    onProgress(out.length, points.length);
    await new Promise((r) => setTimeout(r, 120));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------

const slug = process.argv[2] ?? 'appalachian-trail';
const tolerance = Number(process.argv[3] ?? 10);
const spec = TRAILS[slug];
if (spec === undefined) throw new Error(`Unknown trail "${slug}". Known: ${Object.keys(TRAILS).join(', ')}`);

const here = path.dirname(new URL(import.meta.url).pathname);
const cacheDir = path.join(here, '.cache');
await mkdir(cacheDir, { recursive: true });

process.stderr.write(`${spec.name}: relation ${spec.relation}, tolerance ${tolerance} m\n`);
process.stderr.write(' 1. fetching\n');
const members = await overpass(`[out:json][timeout:280];relation(${spec.relation});out body;rel(r);out body;`, path.join(cacheDir, `${slug}-members.json`));
const geometry = await overpass(`[out:json][timeout:480];relation(${spec.relation});>>;way._;out geom;`, path.join(cacheDir, `${slug}-geom.json`));
const snapshot = geometry.osm3s?.timestamp_osm_base ?? 'unknown';

process.stderr.write(' 2. chaining\n');
const { line, chained, pool } = chain(members, geometry, spec.start);
if (chained !== pool) throw new Error(`chain left ${pool - chained} of ${pool} ways unused: the trail is not one line`);
const fullLength = lengthOf(line);
process.stderr.write(`    ${chained} ways, ${line.length.toLocaleString()} points, ${(fullLength / 1609.344).toFixed(1)} mi\n`);

process.stderr.write(' 3. simplifying\n');
const pts = simplify(line, tolerance);
const simpleLength = lengthOf(pts);
process.stderr.write(`    ${pts.length.toLocaleString()} points, ${(simpleLength / 1609.344).toFixed(1)} mi, ${(100 * (1 - simpleLength / fullLength)).toFixed(2)}% shorter, mean spacing ${(simpleLength / pts.length).toFixed(0)} m\n`);

process.stderr.write(' 4. elevations\n');
const elev = await elevations(pts, (done, total) => {
  if (done % 2000 === 0 || done === total) process.stderr.write(`    ${done}/${total}\n`);
});

// cumulative distance, metres, so the island can address the trail by how far along it you are
const cum = [0];
for (let i = 1; i < pts.length; i += 1) cum.push(cum[i - 1] + haversine(pts[i - 1], pts[i]));

// delta-encoded integers: 1e5 of a degree is about a metre, elevation to the metre
const lon = [];
const lat = [];
const ele = [];
let px = 0;
let py = 0;
let pe = 0;
for (let i = 0; i < pts.length; i += 1) {
  const x = Math.round(pts[i][0] * 1e5);
  const y = Math.round(pts[i][1] * 1e5);
  const e = Math.round(elev[i]);
  lon.push(x - px); lat.push(y - py); ele.push(e - pe);
  px = x; py = y; pe = e;
}

const asset = {
  slug,
  name: spec.name,
  from: spec.from,
  to: spec.to,
  metres: Math.round(simpleLength),
  points: pts.length,
  toleranceM: tolerance,
  osmRelation: spec.relation,
  osmSnapshot: snapshot,
  built: new Date().toISOString().slice(0, 10),
  licence: {
    centreline: 'Centreline derived from OpenStreetMap, © OpenStreetMap contributors, ODbL 1.0 (https://opendatacommons.org/licenses/odbl/1-0/). This is a Derivative Database and is offered under the same licence.',
    elevation: 'Elevations from Open-Meteo (https://open-meteo.com/), CC BY 4.0, over the Copernicus DEM.',
  },
  /** Delta-encoded. Multiply lon/lat by 1e-5 after the running sum; elevation is metres. */
  encoding: 'delta',
  lon,
  lat,
  ele,
};

const outFile = path.join(here, '..', 'data', `${slug}.json`);
await writeFile(outFile, JSON.stringify(asset));
const bytes = (await readFile(outFile)).length;
process.stderr.write(`\nwrote ${path.relative(process.cwd(), outFile)}  ${(bytes / 1024).toFixed(0)} KB raw\n`);
process.stderr.write(`OSM snapshot ${snapshot}\n`);
