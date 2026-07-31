import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const cache = new Map<string, Promise<unknown | undefined>>();

export function loadTacticalKnowledge(mapName: string | undefined) {
  if (!mapName) return Promise.resolve(undefined);
  const cached = cache.get(mapName);
  if (cached) return cached;
  const task = (async () => {
    const candidates = [
      resolve(process.cwd(), "apps/worker/assets/maps", mapName, "processed/tactical-knowledge.json"),
      resolve(process.cwd(), "../worker/assets/maps", mapName, "processed/tactical-knowledge.json"),
    ];
    for (const file of candidates) {
      try { return JSON.parse(await readFile(file, "utf8")) as unknown; } catch { /* try next */ }
    }
    return undefined;
  })();
  cache.set(mapName, task);
  return task;
}
