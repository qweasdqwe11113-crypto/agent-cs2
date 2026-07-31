import { readFile, writeFile } from "node:fs/promises";

const [anchorsPath, navPath, outputPath] = process.argv.slice(2);
if (!anchorsPath || !navPath || !outputPath) throw new Error("Usage: node tools/build-place-regions.mjs <official-anchors.json> <navmesh.json> <output.json>");

const rawAnchors = JSON.parse(await readFile(anchorsPath, "utf8"));
const anchors = { ...rawAnchors, places: (rawAnchors.places ?? rawAnchors.Places).map((place) => place.navAreaId === undefined ? { name: place.Name, chineseName: place.ChineseName, navAreaId: place.NavAreaId } : place) };
const nav = JSON.parse(await readFile(navPath, "utf8"));
const MAX_WALK_DISTANCE = 700;

const center = (polygon) => polygon.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y, z: sum.z + point.z }), { x: 0, y: 0, z: 0 });
const areas = new Map((nav.areas ?? nav.Areas).map((rawArea) => {
  const area = rawArea.polygon ? rawArea : { id: rawArea.Id, hull: rawArea.Hull, polygon: rawArea.Polygon.map((point) => ({ x: point.X, y: point.Y, z: point.Z })), connectedAreaIds: rawArea.ConnectedAreaIds };
  const sum = center(area.polygon);
  return [area.id, { ...area, center: { x: sum.x / area.polygon.length, y: sum.y / area.polygon.length, z: sum.z / area.polygon.length } }];
}));

const queue = [];
const push = (item) => { queue.push(item); queue.sort((a, b) => a.distance - b.distance); };
const assignment = new Map();
for (const place of anchors.places) {
  if (!areas.has(place.navAreaId)) continue;
  push({ areaId: place.navAreaId, place, distance: 0 });
}

while (queue.length) {
  const current = queue.shift();
  if (current.distance > MAX_WALK_DISTANCE || assignment.has(current.areaId)) continue;
  const area = areas.get(current.areaId);
  if (!area) continue;
  assignment.set(current.areaId, current);
  for (const neighbourId of area.connectedAreaIds ?? []) {
    const neighbour = areas.get(neighbourId);
    if (!neighbour || assignment.has(neighbourId)) continue;
    const dx = area.center.x - neighbour.center.x;
    const dy = area.center.y - neighbour.center.y;
    const dz = (area.center.z - neighbour.center.z) * 1.5;
    push({ areaId: neighbourId, place: current.place, distance: current.distance + Math.hypot(dx, dy, dz) });
  }
}

const regions = anchors.places.map((place) => {
  const memberships = [...assignment.values()].filter((entry) => entry.place.name === place.name);
  return {
    name: place.name,
    chineseName: place.chineseName,
    anchorNavAreaId: place.navAreaId,
    navAreaIds: memberships.map((entry) => entry.areaId),
    maxWalkDistance: MAX_WALK_DISTANCE,
    source: "official-env_cs_place anchor + official-de_mirage.nav connectivity",
    confidence: "nav-derived",
  };
});

await writeFile(outputPath, JSON.stringify({ mapName: "de_mirage", schemaVersion: "official-place-nav-regions-v1", method: "multi-source NAV shortest-path Voronoi with a 700-unit cap", regions }));
console.log(`Wrote ${regions.length} derived place regions covering ${assignment.size} NAV areas.`);
