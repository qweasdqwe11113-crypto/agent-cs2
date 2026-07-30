import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { demoAnalysisQueue } from "../../../lib/demo-analysis-queue";

export const runtime = "nodejs";

const MAX_DEMO_SIZE_BYTES = 100 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([".zip", ".dem"]);

function getExtension(filename: string): string {
  return path.extname(filename).toLowerCase();
}

export async function GET(request: Request) {
  const jobId = new URL(request.url).searchParams.get("jobId");
  if (jobId === null || jobId.trim() === "") {
    return NextResponse.json({ error: "缺少任务 ID。" }, { status: 400 });
  }

  const job = await demoAnalysisQueue.getJob(jobId);
  if (job === undefined) {
    return NextResponse.json({ error: "未找到该分析任务。" }, { status: 404 });
  }

  const state = await job.getState();
  return NextResponse.json({
    id: job.id,
    state,
    progress: job.progress,
    failedReason: state === "failed" ? job.failedReason : undefined,
    result: state === "completed" ? job.returnvalue : undefined,
  });
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const demo = formData.get("demo");

  if (!(demo instanceof File)) {
    return NextResponse.json({ error: "缺少 demo 文件。" }, { status: 400 });
  }

  const extension = getExtension(demo.name);
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return NextResponse.json({ error: "仅支持 .zip 或 .dem 文件。" }, { status: 400 });
  }

  if (demo.size === 0 || demo.size > MAX_DEMO_SIZE_BYTES) {
    return NextResponse.json({ error: "文件大小必须在 1 B 到 100 MB 之间。" }, { status: 400 });
  }

  const demoAssetId = randomUUID();
  const matchId = randomUUID();
  const uploadDirectory = path.join(process.cwd(), "data", "uploads");
  const storedFilename = `${demoAssetId}${extension}`;
  const storedPath = path.join(uploadDirectory, storedFilename);

  await mkdir(uploadDirectory, { recursive: true });
  await writeFile(storedPath, Buffer.from(await demo.arrayBuffer()));

  const job = await demoAnalysisQueue.add("analyze-demo", {
    demoAssetId,
    matchId,
    requestedByUserId: "local-development-user",
    source: {
      originalFilename: demo.name,
      storedPath,
      mediaType: demo.type || "application/octet-stream",
    },
  });

  return NextResponse.json({ demoAssetId, matchId, jobId: job.id }, { status: 202 });
}
