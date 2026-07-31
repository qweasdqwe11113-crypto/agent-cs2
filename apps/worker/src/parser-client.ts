import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ParsedPlayer {
  steamId64: string;
  name: string;
  team: "T" | "CT" | "spectator" | "unassigned" | `unknown:${number}`;
  isBot: boolean;
}

export interface ParsedRound {
  number: number;
  endFrame: number;
  winner: "T" | "CT" | "spectator" | "unassigned" | `unknown:${number}`;
  endReason: string;
  message: string;
  players: ParsedRoundPlayer[];
}

export interface ParsedRoundPlayer {
  steamId64: string;
  name: string;
  team: "T" | "CT" | "spectator" | "unassigned" | `unknown:${number}`;
  kills: number;
  deaths: number;
  assists: number;
  headshots: number;
  events: ParsedPlayerEvent[];
}

export interface ParsedPlayerEvent {
  frame: number;
  type: "kill" | "death" | "assist";
  counterpart: string;
  weapon: string;
  isHeadshot: boolean;
}

export interface ParsedDemo {
  schemaVersion: "v1";
  sourcePath: string;
  mapName: string;
  tickRate: number;
  totalFrames: number;
  players: ParsedPlayer[];
  rounds: ParsedRound[];
}

function assertParsedDemo(value: unknown): asserts value is ParsedDemo {
  if (typeof value !== "object" || value === null) {
    throw new Error("Parser returned invalid JSON.");
  }

  const parsed = value as Partial<ParsedDemo>;
  if (
    parsed.schemaVersion !== "v1" ||
    typeof parsed.mapName !== "string" ||
    !Array.isArray(parsed.players) ||
    !Array.isArray(parsed.rounds)
  ) {
    throw new Error("Parser returned an unsupported result schema.");
  }
}

export async function parseDemo(
  executablePath: string,
  demoPath: string,
  timeoutMs: number,
): Promise<ParsedDemo> {
  try {
    const { stdout } = await execFileAsync(executablePath, [demoPath], {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });
    const parsed: unknown = JSON.parse(stdout);
    assertParsedDemo(parsed);
    return parsed;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown parser error.";
    throw new Error(`CS2 demo parser failed: ${detail}`);
  }
}

export interface PlayerRoundAnalysis {
  schemaVersion: "v1" | "v2" | "v3";
  roundNumber: number;
  steamId64: string;
  freezeTimeEndFrame?: number;
  roundTimeSeconds?: number;
  initialState?: { frame: number; health: number; armor: number; money: number; equipmentValue: number; weapon: string };
  samples: Array<{ frame: number; x: number; y: number; z: number; speed: number; yaw: number; pitch: number; health: number; armor: number; weapon: string; radar?: { x: number; y: number }; callout?: string; navArea?: { id: number; hull: number; minZ: number; maxZ: number } }>;
  opponentSamples?: Array<{ frame: number; steamId64: string; name: string; x: number; y: number; z: number; health: number }>;
  otherPlayerSamples?: Array<{ frame: number; steamId64: string; name: string; team: string; x: number; y: number; z: number; health: number; radar?: { x: number; y: number } }>;
  events: Array<{ frame: number; type: string; opponent: string; weapon: string; damage: number; speed: number; stopStatus?: string; confidence?: string }>;
  summary: { shotsFired: number; damageDealt: number; damageTaken: number; movingShots: number };
}

export async function analyzePlayerRound(executablePath: string, demoPath: string, roundNumber: number, steamId64: string, timeoutMs: number): Promise<PlayerRoundAnalysis> {
  const { stdout } = await execFileAsync(executablePath, ["analyze-player-round", demoPath, String(roundNumber), steamId64], { timeout: timeoutMs, maxBuffer: 50 * 1024 * 1024, windowsHide: true });
  const parsed: unknown = JSON.parse(stdout);
  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as Partial<PlayerRoundAnalysis>).events)) throw new Error("Deep parser returned an unsupported result schema.");
  return parsed as PlayerRoundAnalysis;
}
