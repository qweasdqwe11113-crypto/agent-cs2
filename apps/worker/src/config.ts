import path from "node:path";

const DEFAULT_REDIS_URL = "redis://localhost:6379";
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_MAX_DEMO_SIZE_BYTES = 512 * 1024 * 1024;
const DEFAULT_PARSER_TIMEOUT_MS = 120_000;

function parseConcurrency(value: string | undefined): number {
  if (value === undefined) return DEFAULT_CONCURRENCY;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("WORKER_CONCURRENCY must be a positive integer.");
  }

  return parsed;
}

function parsePositiveBytes(value: string | undefined): number {
  if (value === undefined) return DEFAULT_MAX_DEMO_SIZE_BYTES;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("MAX_DEMO_SIZE_BYTES must be a positive integer.");
  }

  return parsed;
}

function parsePositiveMilliseconds(value: string | undefined): number {
  if (value === undefined) return DEFAULT_PARSER_TIMEOUT_MS;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("PARSER_TIMEOUT_MS must be a positive integer.");
  }

  return parsed;
}

export const config = {
  redisUrl: process.env.REDIS_URL ?? DEFAULT_REDIS_URL,
  concurrency: parseConcurrency(process.env.WORKER_CONCURRENCY),
  demoWorkDirectory: process.env.DEMO_WORK_DIRECTORY ?? "data/demos",
  maxDemoSizeBytes: parsePositiveBytes(process.env.MAX_DEMO_SIZE_BYTES),
  parserExecutable:
    process.env.PARSER_EXECUTABLE ?? path.resolve(process.cwd(), "../parser-go/bin/cs2-demo-parser.exe"),
  parserTimeoutMs: parsePositiveMilliseconds(process.env.PARSER_TIMEOUT_MS),
};
