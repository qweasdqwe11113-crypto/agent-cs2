import { NextResponse } from "next/server";

import { demoAnalysisQueue, playerRoundAnalysisQueue } from "../../../lib/demo-analysis-queue";

export const runtime = "nodejs";

interface BaseAnalysisResult {
  importedDemo?: { demo?: { demoPath?: string } };
  parsedDemo?: { mapName?: string };
}

export async function POST(request: Request) {
  const body = await request.json() as { baseAnalysisJobId?: string; roundNumber?: number; steamId64?: string };
  if (!body.baseAnalysisJobId || !Number.isInteger(body.roundNumber) || (body.roundNumber ?? 0) < 1 || !body.steamId64) {
    return NextResponse.json({ error: "请求参数无效。" }, { status: 400 });
  }
  const baseJob = await demoAnalysisQueue.getJob(body.baseAnalysisJobId);
  if (baseJob === undefined || await baseJob.getState() !== "completed") return NextResponse.json({ error: "基础比赛报告尚未完成。" }, { status: 409 });
  const demoPath = (baseJob.returnvalue as BaseAnalysisResult | undefined)?.importedDemo?.demo?.demoPath;
  const mapName = (baseJob.returnvalue as BaseAnalysisResult | undefined)?.parsedDemo?.mapName;
  if (!demoPath) return NextResponse.json({ error: "基础任务没有可用的 demo 文件。" }, { status: 409 });
  const roundNumber = body.roundNumber as number;
  const steamId64 = body.steamId64 as string;
  // Keep manual deep-analysis requests in sync with the parser schema. A new
  // key prevents old cached jobs (without round-clock metadata) being reused.
  const jobId = `deep-v11-${body.baseAnalysisJobId}-${roundNumber}-${steamId64}`;
  if (!mapName) return NextResponse.json({ error: "地图信息不可用。" }, { status: 409 });
  const job = await playerRoundAnalysisQueue.add("analyze-player-round", { baseAnalysisJobId: body.baseAnalysisJobId, demoPath, mapName, roundNumber, steamId64 }, { jobId });
  return NextResponse.json({ jobId: job.id }, { status: 202 });
}

export async function GET(request: Request) {
  const jobId = new URL(request.url).searchParams.get("jobId");
  if (!jobId) return NextResponse.json({ error: "缺少任务 ID。" }, { status: 400 });
  const job = await playerRoundAnalysisQueue.getJob(jobId);
  if (job === undefined) return NextResponse.json({ error: "未找到深度分析任务。" }, { status: 404 });
  const state = await job.getState();
  return NextResponse.json({ id: job.id, state, progress: job.progress, failedReason: state === "failed" ? job.failedReason : undefined, result: state === "completed" ? job.returnvalue : undefined });
}
