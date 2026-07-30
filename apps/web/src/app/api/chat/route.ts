import { NextResponse } from "next/server";

import { demoAnalysisQueue, playerRoundAnalysisQueue } from "../../../lib/demo-analysis-queue";

export const runtime = "nodejs";

interface ChatRequest { message?: string; baseAnalysisJobId?: string; deepAnalysisJobId?: string }

export async function POST(request: Request) {
  const body = await request.json() as ChatRequest;
  if (!body.message?.trim() || !body.baseAnalysisJobId) return NextResponse.json({ error: "缺少问题或比赛任务。" }, { status: 400 });
  const baseUrl = process.env.RIGHTAPI_BASE_URL?.replace(/\/$/, "");
  const apiKey = process.env.RIGHTAPI_API_KEY;
  const model = process.env.RIGHTAPI_MODEL;
  if (!baseUrl || !apiKey || !model) return NextResponse.json({ error: "尚未配置 RightAPI。请在 apps/web/.env.local 设置 RIGHTAPI_BASE_URL、RIGHTAPI_API_KEY、RIGHTAPI_MODEL。" }, { status: 503 });
  const baseJob = await demoAnalysisQueue.getJob(body.baseAnalysisJobId);
  if (baseJob === undefined || await baseJob.getState() !== "completed") return NextResponse.json({ error: "比赛报告尚未完成。" }, { status: 409 });
  let deepResult: unknown;
  if (body.deepAnalysisJobId) { const job = await playerRoundAnalysisQueue.getJob(body.deepAnalysisJobId); if (job && await job.getState() === "completed") deepResult = job.returnvalue; }
  const evidence = JSON.stringify({ match: baseJob.returnvalue?.parsedDemo, selectedPlayerRoundAnalysis: deepResult });
  const response = await fetch(`${baseUrl}/responses`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, store: false, reasoning: { effort: "medium" }, input: [
    { role: "system", content: "你是 CS2 赛后复盘教练。只能使用提供的比赛证据回答；不要臆测。每条结论须指出回合、玩家、帧或事件。若证据不足，明确说明并建议用户生成该玩家该回合的深度分析。回答使用简洁中文。" },
    { role: "system", content: `比赛证据：${evidence}` },
    { role: "user", content: body.message },
  ] }) });
  if (!response.ok) return NextResponse.json({ error: `RightAPI 请求失败：${response.status} ${await response.text()}` }, { status: 502 });
  const result = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  const answer = result.output_text ?? result.output?.flatMap((item) => item.content ?? []).map((content) => content.text ?? "").join("");
  if (!answer) return NextResponse.json({ error: "RightAPI 未返回可用回答。" }, { status: 502 });
  return NextResponse.json({ answer });
}
