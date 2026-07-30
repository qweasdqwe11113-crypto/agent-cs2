import { Queue } from "bullmq";
import { Redis } from "ioredis";

import { config } from "./config.js";
import { DEMO_ANALYSIS_QUEUE, PLAYER_ROUND_ANALYSIS_QUEUE, type DemoAnalysisJob, type PlayerRoundAnalysisJob } from "./jobs.js";

const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });

export const demoAnalysisQueue = new Queue<DemoAnalysisJob>(DEMO_ANALYSIS_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: 1_000,
    removeOnFail: 5_000,
  },
});

export const playerRoundAnalysisQueue = new Queue<PlayerRoundAnalysisJob>(PLAYER_ROUND_ANALYSIS_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: 500,
    removeOnFail: 2_000,
  },
});
