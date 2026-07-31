import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

type Point3 = { x: number; y: number; z: number };
type NavArea = { id: number; hull: number; polygon: Array<{ x: number; y: number; z: number }> };
type NavMesh = { mapName: string; schemaVersion: "source2-nav-v1"; source: string; navVersion: number; areas: NavArea[] };

let mirageNavMesh: Promise<NavMesh> | undefined;

function containsXY(point: Point3, polygon: NavArea["polygon"]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const current = polygon[i]!;
    const previous = polygon[j]!;
    if ((current.y > point.y) !== (previous.y > point.y) && point.x < (previous.x - current.x) * (point.y - current.y) / (previous.y - current.y) + current.x) inside = !inside;
  }
  return inside;
}

/** Returns an official Source 2 NAV area. It intentionally does not invent a named callout. */
export async function getMirageNavArea(point: Point3) {
  mirageNavMesh ??= readFile(fileURLToPath(new URL("../assets/maps/de_mirage/processed/navmesh.json", import.meta.url)), "utf8").then(JSON.parse) as Promise<NavMesh>;
  const nav = await mirageNavMesh;
  const matches = nav.areas
    .filter((area) => containsXY(point, area.polygon))
    .map((area) => {
      const zs = area.polygon.map((vertex) => vertex.z);
      const minZ = Math.min(...zs);
      const maxZ = Math.max(...zs);
      const centerZ = (minZ + maxZ) / 2;
      return { area, minZ, maxZ, verticalDistance: Math.abs(point.z - centerZ) };
    })
    .filter((match) => point.z >= match.minZ - 72 && point.z <= match.maxZ + 72)
    .sort((a, b) => a.verticalDistance - b.verticalDistance);
  const match = matches[0];
  return match ? { id: match.area.id, hull: match.area.hull, minZ: Math.round(match.minZ), maxZ: Math.round(match.maxZ) } : undefined;
}
