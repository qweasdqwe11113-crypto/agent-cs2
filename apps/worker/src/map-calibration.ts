export interface RadarCalibration {
  mapName: string;
  status: "calibrated" | "needs_official_overview";
  radarImage: string;
  imageWidth: number | null;
  imageHeight: number | null;
  originX: number | null;
  originY: number | null;
  scale: number | null;
  flipY: boolean;
}

export function worldToRadar(calibration: RadarCalibration, world: { x: number; y: number }) {
  if (calibration.status !== "calibrated" || calibration.originX === null || calibration.originY === null || calibration.scale === null) return undefined;
  return {
    x: (world.x - calibration.originX) / calibration.scale,
    y: calibration.flipY ? (calibration.originY - world.y) / calibration.scale : (world.y - calibration.originY) / calibration.scale,
  };
}

let mirageCalibration: Promise<RadarCalibration> | undefined;

export function loadMirageRadarCalibration() {
  mirageCalibration ??= readFile(fileURLToPath(new URL("../assets/maps/de_mirage/processed/calibration.json", import.meta.url)), "utf8").then(JSON.parse) as Promise<RadarCalibration>;
  return mirageCalibration;
}
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
