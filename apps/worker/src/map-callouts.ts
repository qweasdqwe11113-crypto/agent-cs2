/**
 * Curated Mirage callouts aligned to the 1024x1024 overview used by the web
 * radar. These are deliberately small, named tactical sub-areas. The worker
 * still uses the official Source 2 NAV mesh for the actual walkable area and
 * Z layer; this overlay only refines the human-facing Chinese callout.
 */
type Point = [number, number];
type Region = { name: string; polygon: Point[] };

function contains(point: { x: number; y: number }, polygon: Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    if ((yi > point.y) !== (yj > point.y) && point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function area(polygon: Point[]) {
  return Math.abs(polygon.reduce((sum, [x, y], index) => {
    const [nextX, nextY] = polygon[(index + 1) % polygon.length]!;
    return sum + x * nextY - nextX * y;
  }, 0)) / 2;
}

// Coordinates are radar pixels, not world coordinates. Smaller regions win.
// The names and placement follow the provided Chinese Mirage callout overview.
const MIRAGE_REFERENCE_REGIONS: Region[] = [
  { name: "B 二楼", polygon: [[155, 160], [430, 160], [430, 235], [155, 235]] },
  { name: "厨房", polygon: [[390, 195], [485, 195], [485, 250], [390, 250]] },
  { name: "下水道楼梯", polygon: [[470, 205], [590, 205], [590, 270], [470, 270]] },
  { name: "B 连接", polygon: [[390, 250], [510, 250], [510, 330], [390, 330]] },
  { name: "B 包点", polygon: [[105, 235], [275, 235], [275, 345], [105, 345]] },
  { name: "白车", polygon: [[105, 175], [185, 175], [185, 250], [105, 250]] },
  { name: "超市", polygon: [[135, 400], [285, 400], [285, 510], [135, 510]] },
  { name: "窗口", polygon: [[385, 315], [475, 315], [475, 395], [385, 395]] },
  { name: "小黑屋", polygon: [[435, 290], [525, 290], [525, 350], [435, 350]] },
  { name: "下水道", polygon: [[435, 340], [505, 340], [505, 470], [435, 470]] },
  { name: "B 小", polygon: [[500, 385], [625, 385], [625, 455], [500, 455]] },
  { name: "中路", polygon: [[505, 445], [665, 445], [665, 570], [505, 570]] },
  { name: "中远", polygon: [[680, 330], [790, 330], [790, 430], [680, 430]] },
  { name: "沙袋", polygon: [[700, 405], [780, 405], [780, 485], [700, 485]] },
  { name: "连接", polygon: [[415, 555], [525, 555], [525, 675], [415, 675]] },
  { name: "丛林", polygon: [[335, 610], [440, 610], [440, 715], [335, 715]] },
  { name: "警家", polygon: [[225, 660], [370, 660], [370, 790], [225, 790]] },
  { name: "A 楼梯", polygon: [[430, 650], [520, 650], [520, 760], [430, 760]] },
  { name: "A 坡", polygon: [[550, 580], [720, 580], [720, 720], [550, 720]] },
  { name: "A 近", polygon: [[650, 555], [790, 555], [790, 650], [650, 650]] },
  { name: "A 一箱", polygon: [[685, 630], [770, 630], [770, 705], [685, 705]] },
  { name: "三明治", polygon: [[565, 665], [655, 665], [655, 735], [565, 735]] },
  { name: "短箱", polygon: [[590, 735], [670, 735], [670, 815], [590, 815]] },
  { name: "长箱", polygon: [[495, 730], [590, 730], [590, 835], [495, 835]] },
  { name: "默认包点", polygon: [[510, 790], [610, 790], [610, 885], [510, 885]] },
  { name: "火箱", polygon: [[610, 740], [700, 740], [700, 825], [610, 825]] },
  { name: "忍者位", polygon: [[450, 815], [520, 815], [520, 885], [450, 885]] },
  { name: "A 包点", polygon: [[470, 700], [700, 700], [700, 900], [470, 900]] },
  { name: "A 二楼", polygon: [[740, 760], [900, 760], [900, 890], [740, 890]] },
];

export function getMirageReferenceCallout(radar: { x: number; y: number }) {
  return MIRAGE_REFERENCE_REGIONS
    .filter((region) => contains(radar, region.polygon))
    .sort((left, right) => area(left.polygon) - area(right.polygon))[0]?.name;
}
