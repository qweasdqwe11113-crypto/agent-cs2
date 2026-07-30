import { Queue } from "bullmq";
import { Redis } from "ioredis";

const DEMO_ANALYSIS_QUEUE = "demo-analysis";
const PLAYER_ROUND_ANALYSIS_QUEUE = "player-round-analysis";

export interface DemoAnalysisJobPayload {
  demoAssetId: string;
  matchId: string;
  requestedByUserId: string;
  source: {
    originalFilename: string;
    storedPath: string;
    mediaType: string;
  };
}

export interface PlayerRoundAnalysisJobPayload {
  baseAnalysisJobId: string;
  demoPath: string;
  roundNumber: number;
  steamId64: string;
}

const globalForQueue = globalThis as typeof globalThis & {
  demoAnalysisQueue?: Queue<DemoAnalysisJobPayload>;
  playerRoundAnalysisQueue?: Queue<PlayerRoundAnalysisJobPayload>;
};

export const demoAnalysisQueue =
  globalForQueue.demoAnalysisQueue ??
  new Queue<DemoAnalysisJobPayload>(DEMO_ANALYSIS_QUEUE, {
    connection: new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: null,
    }),
  });

if (process.env.NODE_ENV !== "production") {
  globalForQueue.demoAnalysisQueue = demoAnalysisQueue;
}

export const playerRoundAnalysisQueue = globalForQueue.playerRoundAnalysisQueue ?? new Queue<PlayerRoundAnalysisJobPayload>(PLAYER_ROUND_ANALYSIS_QUEUE, { connection: new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null }) });

if (process.env.NODE_ENV !== "production") globalForQueue.playerRoundAnalysisQueue = playerRoundAnalysisQueue;
