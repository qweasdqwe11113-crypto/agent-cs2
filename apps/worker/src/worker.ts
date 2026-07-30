import { Worker } from "bullmq";
import { Redis } from "ioredis";

import { config } from "./config.js";
import { importDemo } from "./demo-import.js";
import { DEMO_ANALYSIS_QUEUE, PLAYER_ROUND_ANALYSIS_QUEUE, type DemoAnalysisJob, type PlayerRoundAnalysisJob } from "./jobs.js";
import { analyzePlayerRound, parseDemo } from "./parser-client.js";

export function createDemoAnalysisWorker() {
  const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });

  const worker = new Worker<DemoAnalysisJob>(
    DEMO_ANALYSIS_QUEUE,
    async (job) => {
      await job.updateProgress(5);
      console.info("Received demo analysis job", {
        jobId: job.id,
        demoAssetId: job.data.demoAssetId,
        originalFilename: job.data.source.originalFilename,
      });

      const importedDemo = await importDemo(
        job.data.source.storedPath,
        config.demoWorkDirectory,
        config.maxDemoSizeBytes,
      );
      await job.updateProgress(50);

      if (importedDemo.demo.format !== "source2-demo") {
        throw new Error(`Unsupported demo signature: ${importedDemo.demo.signature}`);
      }

      console.info("Demo imported", {
        jobId: job.id,
        archiveType: importedDemo.archiveType,
        demoPath: importedDemo.demo.demoPath,
        byteSize: importedDemo.demo.byteSize,
        sha256: importedDemo.demo.sha256,
      });

      const parsedDemo = await parseDemo(
        config.parserExecutable,
        importedDemo.demo.demoPath,
        config.parserTimeoutMs,
      );
      await job.updateProgress(85);

      console.info("Demo parsed", {
        jobId: job.id,
        mapName: parsedDemo.mapName,
        playerCount: parsedDemo.players.length,
        roundCount: parsedDemo.rounds.length,
      });

      // TODO: persist parsedDemo -> run rules -> persist insights.
      await job.updateProgress(100);

      return { status: "parsed", importedDemo, parsedDemo, analyzedAt: new Date().toISOString() };
    },
    { connection, concurrency: config.concurrency },
  );

  worker.on("completed", (job) => console.info("Demo analysis job completed", { jobId: job.id }));
  worker.on("failed", (job, error) => console.error("Demo analysis job failed", { jobId: job?.id, error }));
  worker.on("ready", () =>
    console.info("Demo analysis worker is ready and waiting for jobs", {
      queue: DEMO_ANALYSIS_QUEUE,
      concurrency: config.concurrency,
    }),
  );
  worker.on("error", (error) => console.error("Demo analysis worker connection error", error));

  return worker;
}

export function createPlayerRoundAnalysisWorker() {
  const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  const worker = new Worker<PlayerRoundAnalysisJob>(PLAYER_ROUND_ANALYSIS_QUEUE, async (job) => {
    await job.updateProgress(5);
    const analysis = await analyzePlayerRound(config.parserExecutable, job.data.demoPath, job.data.roundNumber, job.data.steamId64, config.parserTimeoutMs);
    await job.updateProgress(100);
    console.info("Player round analysis completed", { jobId: job.id, round: job.data.roundNumber, player: job.data.steamId64, events: analysis.events.length });
    return { status: "completed", analysis, analyzedAt: new Date().toISOString() };
  }, { connection, concurrency: 1 });
  worker.on("ready", () => console.info("Player round analysis worker is ready and waiting for jobs"));
  worker.on("failed", (job, error) => console.error("Player round analysis failed", { jobId: job?.id, error }));
  worker.on("error", (error) => console.error("Player round analysis worker connection error", error));
  return worker;
}
