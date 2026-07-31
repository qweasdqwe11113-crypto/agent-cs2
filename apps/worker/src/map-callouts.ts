import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

type Point = [number, number];
type Callout = { name: string; aliases: string[]; polygon: Point[] };
type CalloutMap = { mapName: string; regions: Callout[] };

let mirageCallouts: Promise<CalloutMap> | undefined;

function contains(point: { x: number; y: number }, polygon: Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!; const [xj, yj] = polygon[j]!;
    if ((yi > point.y) !== (yj > point.y) && point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function polygonArea(polygon: Point[]) {
  return Math.abs(polygon.reduce((area, [x, y], index) => { const [nextX, nextY] = polygon[(index + 1) % polygon.length]!; return area + x * nextY - nextX * y; }, 0)) / 2;
}

const chineseCallouts: Record<string, string> = {
  "T Spawn": "T 出生点", "CT Spawn": "CT 出生点", "Bombsite A": "A 包点", "Bombsite B": "B 包点",
  "B Apartments": "B 二楼", "Short": "小道", "Top Mid": "中路上", "Mid": "中路", "Connector": "连接", "Jungle": "丛林", "A Ramp": "A 坡", "Palace": "A 二楼",
  "Window": "中路窗口", "Underpass": "下水道", "Market": "B 市场", "Van": "B 车位", "Ticket": "A 警家票亭", "Stairs": "A 楼梯", "Default": "默认包点", "Firebox": "火箱", "Bench": "长椅",
};

export async function getMirageCallout(point: { x: number; y: number }) {
  mirageCallouts ??= readFile(fileURLToPath(new URL("../assets/maps/de_mirage/processed/callouts.json", import.meta.url)), "utf8").then(JSON.parse) as Promise<CalloutMap>;
  const map = await mirageCallouts;
  const region = map.regions.filter((candidate) => contains(point, candidate.polygon)).sort((a, b) => polygonArea(a.polygon) - polygonArea(b.polygon))[0];
  return region ? (chineseCallouts[region.name] ?? region.name) : undefined;
}
