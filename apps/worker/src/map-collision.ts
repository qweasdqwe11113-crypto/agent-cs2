import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

type Vec3 = { X: number; Y: number; Z: number };
type Hull = { Vertices: Vec3[]; Faces: number[] };
type CollisionMap = { MapName: string; Hulls: Hull[] };
export type AimSample = { frame: number; x: number; y: number; z: number; yaw: number; pitch: number };
export type OpponentSample = { frame: number; steamId64: string; name: string; x: number; y: number; z: number; health: number };
export type VisibilityCheck = { frame: number; opponent: string; opponentSteamId64: string; nearCrosshair: boolean; blockedByGeometry: boolean; blockingDistance?: number };

let mirageCollision: Promise<CollisionMap> | undefined;

async function loadMirageCollision() {
  mirageCollision ??= readFile(fileURLToPath(new URL("../assets/maps/de_mirage/processed/collision.json", import.meta.url)), "utf8").then(JSON.parse) as Promise<CollisionMap>;
  return mirageCollision;
}

function direction(yaw: number, pitch: number) {
  const y = yaw * Math.PI / 180;
  const p = pitch * Math.PI / 180;
  return { x: Math.cos(p) * Math.cos(y), y: Math.cos(p) * Math.sin(y), z: -Math.sin(p) };
}

function rayTriangle(origin: { x: number; y: number; z: number }, ray: { x: number; y: number; z: number }, a: Vec3, b: Vec3, c: Vec3) {
  const edge1 = { x: b.X - a.X, y: b.Y - a.Y, z: b.Z - a.Z };
  const edge2 = { x: c.X - a.X, y: c.Y - a.Y, z: c.Z - a.Z };
  const cross = { x: ray.y * edge2.z - ray.z * edge2.y, y: ray.z * edge2.x - ray.x * edge2.z, z: ray.x * edge2.y - ray.y * edge2.x };
  const determinant = edge1.x * cross.x + edge1.y * cross.y + edge1.z * cross.z;
  if (Math.abs(determinant) < 0.000001) return undefined;
  const inverse = 1 / determinant;
  const offset = { x: origin.x - a.X, y: origin.y - a.Y, z: origin.z - a.Z };
  const u = (offset.x * cross.x + offset.y * cross.y + offset.z * cross.z) * inverse;
  if (u < 0 || u > 1) return undefined;
  const q = { x: offset.y * edge1.z - offset.z * edge1.y, y: offset.z * edge1.x - offset.x * edge1.z, z: offset.x * edge1.y - offset.y * edge1.x };
  const v = (ray.x * q.x + ray.y * q.y + ray.z * q.z) * inverse;
  if (v < 0 || u + v > 1) return undefined;
  const distance = (edge2.x * q.x + edge2.y * q.y + edge2.z * q.z) * inverse;
  return distance > 0.01 ? distance : undefined;
}

function facesToTriangles(hull: Hull) {
  const triangles: Array<[Vec3, Vec3, Vec3]> = [];
  let polygon: number[] = [];
  for (const index of [...hull.Faces, -1]) {
    if (index >= 0) polygon.push(index);
    else { for (let i = 1; i + 1 < polygon.length; i++) { const a = hull.Vertices[polygon[0] ?? -1]; const b = hull.Vertices[polygon[i] ?? -1]; const c = hull.Vertices[polygon[i + 1] ?? -1]; if (a && b && c) triangles.push([a, b, c]); } polygon = []; }
  }
  return triangles;
}

export async function analyzeShotVisibility(mapName: string, samples: AimSample[], opponents: OpponentSample[], shotFrames: number[]): Promise<VisibilityCheck[]> {
  if (mapName !== "de_mirage") return [];
  const collision = await loadMirageCollision();
  const triangles = collision.Hulls.flatMap(facesToTriangles);
  const checks: VisibilityCheck[] = [];
  for (const frame of shotFrames) {
    const sample = samples.reduce((nearest, value) => Math.abs(value.frame - frame) < Math.abs(nearest.frame - frame) ? value : nearest);
    const ray = direction(sample.yaw, sample.pitch);
    const origin = { x: sample.x, y: sample.y, z: sample.z + 64 };
    for (const opponent of opponents.filter((value) => value.frame === sample.frame)) {
      const offset = { x: opponent.x - origin.x, y: opponent.y - origin.y, z: opponent.z + 48 - origin.z };
      const distance = offset.x * ray.x + offset.y * ray.y + offset.z * ray.z;
      const perpendicular = Math.sqrt(Math.max(0, offset.x ** 2 + offset.y ** 2 + offset.z ** 2 - distance ** 2));
      const nearCrosshair = distance > 0 && perpendicular <= 22;
      if (!nearCrosshair) continue;
      let hit: number | undefined;
      for (const triangle of triangles) { const candidate = rayTriangle(origin, ray, ...triangle); if (candidate !== undefined && candidate < distance && (hit === undefined || candidate < hit)) hit = candidate; }
      checks.push({ frame: sample.frame, opponent: opponent.name, opponentSteamId64: opponent.steamId64, nearCrosshair, blockedByGeometry: hit !== undefined, ...(hit === undefined ? {} : { blockingDistance: hit }) });
    }
  }
  return checks;
}
