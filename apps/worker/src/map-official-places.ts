import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

type OfficialPlace = { name: string; chineseName: string; navAreaId: number; source: "official-env_cs_place + official-de_mirage.nav" };
type OfficialPlaceMap = { mapName: "de_mirage"; schemaVersion: "official-place-nav-anchor-v1"; places: OfficialPlace[] };
type DerivedPlaceMap = { regions: Array<{ chineseName: string; anchorNavAreaId: number; navAreaIds: number[] }> };

let miragePlaces: Promise<OfficialPlaceMap> | undefined;
let mirageDerivedPlaces: Promise<DerivedPlaceMap> | undefined;

/**
 * Resolves only a Source 2 env_cs_place anchor that was matched to its real NAV polygon.
 * It deliberately does not extrapolate a label to neighbouring NAV areas.
 */
export async function getMirageOfficialPlace(navAreaId: number | undefined) {
  if (navAreaId === undefined) return undefined;
  miragePlaces ??= readFile(fileURLToPath(new URL("../assets/maps/de_mirage/processed/official-place-nav-anchors.json", import.meta.url)), "utf8").then(JSON.parse) as Promise<OfficialPlaceMap>;
  const direct = (await miragePlaces).places.find((place) => place.navAreaId === navAreaId);
  if (direct) return direct.chineseName;
  mirageDerivedPlaces ??= readFile(fileURLToPath(new URL("../assets/maps/de_mirage/processed/official-place-nav-regions.json", import.meta.url)), "utf8").then(JSON.parse) as Promise<DerivedPlaceMap>;
  const derived = (await mirageDerivedPlaces).regions.find((region) => region.navAreaIds.includes(navAreaId));
  return derived ? `${derived.chineseName}（NAV 推导）` : undefined;
}
