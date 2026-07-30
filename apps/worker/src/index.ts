import { createDemoAnalysisWorker, createPlayerRoundAnalysisWorker } from "./worker.js";

const worker = createDemoAnalysisWorker();
const playerRoundWorker = createPlayerRoundAnalysisWorker();

console.info("Starting demo analysis worker.");

async function shutdown(signal: string) {
  console.info(`Received ${signal}; closing worker.`);
  await worker.close();
  await playerRoundWorker.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
