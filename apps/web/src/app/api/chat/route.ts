import { NextResponse } from "next/server";

import { demoAnalysisQueue, playerRoundAnalysisQueue } from "../../../lib/demo-analysis-queue";

export const runtime = "nodejs";

interface ChatRequest { message?: string; baseAnalysisJobId?: string; deepAnalysisJobId?: string }

interface BaseAnalysisResult {
  importedDemo?: { demo?: { demoPath?: string } };
  parsedDemo?: {
    mapName?: string;
    tickRate?: number;
    totalFrames?: number;
    players?: Array<{ steamId64: string; name: string; isBot?: boolean }>;
    rounds?: Array<{ number: number; winner?: string; endReason?: string; message?: string; players?: Array<{ steamId64: string; name?: string; team?: string; kills?: number; deaths?: number; assists?: number; headshots?: number; events?: unknown[] }> }>;
  };
}

type ResponsesResult = {
  output_text?: string;
  output?: Array<{ type?: string; name?: string; arguments?: string; content?: Array<{ text?: string }> }>;
};

type DeepAnalysis = {
  roundNumber?: number;
  steamId64?: string;
  initialState?: { frame: number; health: number; armor: number; money: number; equipmentValue: number; weapon: string };
  samples?: Array<{ frame: number; x: number; y: number; z: number; yaw: number; pitch: number; speed: number; health: number; armor: number; weapon: string }>;
  opponentSamples?: Array<{ frame: number; steamId64: string; name: string; x: number; y: number; z: number; health: number }>;
  events?: Array<{ frame: number; type: string; opponent: string; weapon: string; damage: number; speed: number; stopStatus?: string; confidence?: string }>;
};

const WEAPON_PROFILES: Record<string, { name: string; damage: number; armorPenetration: number; rpm: number; magazine: number; price: number }> = {
  ak47: { name: "AK-47", damage: 36, armorPenetration: 77.5, rpm: 600, magazine: 30, price: 2700 },
  "m4a4": { name: "M4A4", damage: 33, armorPenetration: 70, rpm: 666.7, magazine: 30, price: 3100 },
  m4a1s: { name: "M4A1-S", damage: 38, armorPenetration: 70, rpm: 600, magazine: 20, price: 2900 },
  "awp": { name: "AWP", damage: 115, armorPenetration: 97.5, rpm: 41, magazine: 5, price: 4750 },
  galilar: { name: "Galil AR", damage: 30, armorPenetration: 77.5, rpm: 666.7, magazine: 35, price: 1800 },
  "famas": { name: "FAMAS", damage: 30, armorPenetration: 70, rpm: 666.7, magazine: 25, price: 2050 },
  "mp9": { name: "MP9", damage: 26, armorPenetration: 60, rpm: 857.1, magazine: 30, price: 1250 },
  mac10: { name: "MAC-10", damage: 29, armorPenetration: 57.5, rpm: 800, magazine: 30, price: 1050 },
  "deagle": { name: "Desert Eagle", damage: 53, armorPenetration: 93.2, rpm: 266.7, magazine: 7, price: 700 },
  glock18: { name: "Glock-18", damage: 30, armorPenetration: 47, rpm: 400, magazine: 20, price: 200 },
};

function weaponKey(name: string) { return name.trim().toLowerCase().replace(/^eq/, "").replace(/[^a-z0-9]/g, ""); }

function nearestSample(samples: NonNullable<DeepAnalysis["samples"]>, frame: number) {
  return samples.reduce((nearest, candidate) => Math.abs(candidate.frame - frame) < Math.abs(nearest.frame - frame) ? candidate : nearest);
}

function viewDirection(yaw: number, pitch: number) {
  const yawRadians = yaw * Math.PI / 180;
  const pitchRadians = pitch * Math.PI / 180;
  return { x: Math.cos(pitchRadians) * Math.cos(yawRadians), y: Math.cos(pitchRadians) * Math.sin(yawRadians), z: -Math.sin(pitchRadians) };
}

function aimRayCandidates(sample: NonNullable<DeepAnalysis["samples"]>[number], opponents: NonNullable<DeepAnalysis["opponentSamples"]>) {
  const direction = viewDirection(sample.yaw, sample.pitch);
  const origin = { x: sample.x, y: sample.y, z: sample.z + 64 };
  return opponents.map((opponent) => {
    const target = { x: opponent.x, y: opponent.y, z: opponent.z + 48 };
    const offset = { x: target.x - origin.x, y: target.y - origin.y, z: target.z - origin.z };
    const forwardDistance = offset.x * direction.x + offset.y * direction.y + offset.z * direction.z;
    const perpendicularDistance = Math.sqrt(Math.max(0, offset.x ** 2 + offset.y ** 2 + offset.z ** 2 - forwardDistance ** 2));
    return { name: opponent.name, steamId64: opponent.steamId64, health: opponent.health, forwardDistance, perpendicularDistance, intersectsPlayerCapsuleApproximation: forwardDistance > 0 && perpendicularDistance <= 22 };
  }).sort((a, b) => a.perpendicularDistance - b.perpendicularDistance);
}

function parseResponsesResult(responseText: string): ResponsesResult | undefined {
  try { return JSON.parse(responseText) as ResponsesResult; } catch { /* Try SSE below. */ }
  const events = [...responseText.matchAll(/^data:\s*(.+)$/gm)]
    .map((match) => match[1] ?? "")
    .filter((data) => data !== "[DONE]")
    .map((data) => { try { return JSON.parse(data) as { type?: string; response?: ResponsesResult }; } catch { return undefined; } })
    .filter((event): event is { type?: string; response?: ResponsesResult } => event !== undefined);
  return events.findLast((event) => event.type === "response.completed" || event.type === "response.done")?.response;
}

export async function POST(request: Request) {
  const body = await request.json() as ChatRequest;
  if (!body.message?.trim() || !body.baseAnalysisJobId) return NextResponse.json({ error: "缺少问题或比赛任务。" }, { status: 400 });

  const baseUrl = process.env.RIGHTAPI_BASE_URL?.replace(/\/$/, "");
  const apiKey = process.env.RIGHTAPI_API_KEY;
  const model = process.env.RIGHTAPI_MODEL;
  if (!baseUrl || !apiKey || !model) return NextResponse.json({ error: "尚未配置 RightAPI。请在 apps/web/.env.local 设置 RIGHTAPI_BASE_URL、RIGHTAPI_API_KEY、RIGHTAPI_MODEL。" }, { status: 503 });

  const baseJob = await demoAnalysisQueue.getJob(body.baseAnalysisJobId);
  if (baseJob === undefined || await baseJob.getState() !== "completed") return NextResponse.json({ error: "比赛报告尚未完成。" }, { status: 409 });
  const baseResult = baseJob.returnvalue as BaseAnalysisResult | undefined;

  let deepResult: unknown;
  if (body.deepAnalysisJobId) {
    const job = await playerRoundAnalysisQueue.getJob(body.deepAnalysisJobId);
    if (job && await job.getState() === "completed") deepResult = job.returnvalue;
  }

  const evidence = JSON.stringify({ match: baseResult?.parsedDemo, selectedPlayerRoundAnalysis: deepResult });
  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model, store: false, stream: false, reasoning: { effort: "medium" },
      input: [
        { role: "system", content: "你是 CS2 赛后复盘教练。只能依据提供的比赛证据回答，不要猜测。每条结论必须指出回合、玩家、帧或事件。若问题需要某位玩家某回合的移动、开火、伤害、交火或逐帧证据，而证据中没有该回合的 selectedPlayerRoundAnalysis，必须调用 analyze_player_round；仅当用户的问题可由当前证据回答时才直接回答。" },
        { role: "system", content: `比赛证据：${evidence}` },
        { role: "system", content: "工具规则：问血量、护甲、速度、手持武器、开火前移动状态或某段移动时，若已有 selectedPlayerRoundAnalysis，调用对应的 get_player_* 工具；若没有，先调用 analyze_player_round。问武器基础伤害、穿甲、射速、弹匣或价格时调用 get_weapon_profile。" },
        { role: "system", content: "准星规则：评估预瞄或准星摆放时，调用 get_player_aim_at_frame、get_player_position_at_frame 或 get_aim_targeting_at_frame。视线工具可用敌方身体胶囊近似判断准星附近目标；在地图碰撞体与雷达标定完成前，禁止断言两者之间无墙体遮挡，或准星精确落在头部、墙角或具体点位。" },
        { role: "user", content: body.message },
      ],
      tools: [{
        type: "function", name: "analyze_player_round",
        description: "为指定的比赛回合和玩家创建一次按需深度 Demo 分析。仅在需要移动、开火、伤害、交火或逐帧证据且当前没有该回合深度分析时调用。",
        parameters: {
          type: "object",
          properties: { roundNumber: { type: "integer", description: "比赛回合编号" }, steamId64: { type: "string", description: "报告 players 中的玩家 SteamID64" }, reason: { type: "string", description: "需要补充的证据" } },
          required: ["roundNumber", "steamId64", "reason"], additionalProperties: false,
        },
      }, {
        type: "function", name: "find_player",
        description: "按昵称片段或 SteamID64 查找本场比赛的玩家。当用户只说昵称、ID 片段或‘我’而无法唯一对应玩家时调用。",
        parameters: { type: "object", properties: { query: { type: "string", description: "玩家昵称或 SteamID64 的完整值/片段" } }, required: ["query"], additionalProperties: false },
      }, {
        type: "function", name: "get_round_summary",
        description: "读取某一回合已有的基础比分、胜方和所有玩家 K/D/A/击杀事件。适合回答回合结果、谁击杀谁等问题；不能提供逐帧移动与开火细节。",
        parameters: { type: "object", properties: { roundNumber: { type: "integer", description: "比赛回合编号" } }, required: ["roundNumber"], additionalProperties: false },
      }, {
        type: "function", name: "compare_player_rounds",
        description: "汇总比较一位玩家连续多个回合的 K/D/A、爆头和击杀事件。适合回答经济回合之外的表现趋势；不代替逐帧深度分析。",
        parameters: { type: "object", properties: { steamId64: { type: "string", description: "报告 players 中的 SteamID64" }, fromRound: { type: "integer", description: "起始回合（含）" }, toRound: { type: "integer", description: "结束回合（含）" } }, required: ["steamId64", "fromRound", "toRound"], additionalProperties: false },
      }, {
        type: "function", name: "get_player_state_at_frame",
        description: "查询当前已完成深度分析中，目标玩家在指定帧附近的血量、护甲、速度、手持武器。若没有该玩家该回合的深度分析，先调用 analyze_player_round。",
        parameters: { type: "object", properties: { frame: { type: "integer", description: "要查询的 Demo 帧号" } }, required: ["frame"], additionalProperties: false },
      }, {
        type: "function", name: "get_player_movement_segment",
        description: "查询当前已完成深度分析中一段帧区间的速度变化、最高/最低/平均速度、开火和急停状态。若没有深度分析，先调用 analyze_player_round。",
        parameters: { type: "object", properties: { startFrame: { type: "integer" }, endFrame: { type: "integer" } }, required: ["startFrame", "endFrame"], additionalProperties: false },
      }, {
        type: "function", name: "get_player_loadout",
        description: "查询当前已完成深度分析中该玩家回合开始的血甲、金钱、装备价值、主武器，以及该回合实际使用过的武器。若没有深度分析，先调用 analyze_player_round。",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      }, {
        type: "function", name: "get_weapon_profile",
        description: "查询常用 CS2 武器的静态资料：基础伤害、护甲穿透、射速、弹匣和价格。它不是本局实际伤害；需要结合深度分析事件说明实际表现。",
        parameters: { type: "object", properties: { weapon: { type: "string", description: "武器名称，例如 AK-47、M4A4、AWP、Desert Eagle" } }, required: ["weapon"], additionalProperties: false },
      }, {
        type: "function", name: "get_player_position_at_frame",
        description: "查询当前已完成深度分析中，目标玩家在指定帧附近的地图世界坐标、移动速度、血甲、武器与附近事件。若没有深度分析，先调用 analyze_player_round。",
        parameters: { type: "object", properties: { frame: { type: "integer", description: "要查询的 Demo 帧号" } }, required: ["frame"], additionalProperties: false },
      }, {
        type: "function", name: "get_player_aim_at_frame",
        description: "查询当前已完成深度分析中，目标玩家在指定帧附近的视角 Yaw/Pitch、世界坐标、移动状态和附近交火事件，用于预瞄与准星摆放复盘。它只反映准星朝向，不能在没有地图碰撞体和敌方骨骼数据时断言准星精确落点。",
        parameters: { type: "object", properties: { frame: { type: "integer", description: "要查询的 Demo 帧号" } }, required: ["frame"], additionalProperties: false },
      }, {
        type: "function", name: "get_aim_targeting_at_frame",
        description: "对当前已完成深度分析的指定帧执行视线几何检查：将玩家视角射线与同帧敌方玩家胶囊近似相交，列出准星附近敌人。它不包含地图墙体碰撞；必须把无遮挡结论表述为待地图碰撞数据验证。",
        parameters: { type: "object", properties: { frame: { type: "integer", description: "要检查的 Demo 帧号" } }, required: ["frame"], additionalProperties: false },
      }, {
        type: "function", name: "get_map_info",
        description: "查询当前比赛地图名称、tickrate、总帧数、回合数和玩家数。地图世界坐标尚未标定到雷达图/点位名时，必须说明坐标仅供相对位置判断。",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      }],
    }),
  });

  const responseText = await response.text();
  if (!response.ok) return NextResponse.json({ error: `RightAPI 请求失败：${response.status} ${responseText || "（响应为空）"}` }, { status: 502 });
  if (!responseText.trim()) return NextResponse.json({ error: "RightAPI 返回了成功状态，但响应内容为空。" }, { status: 502 });
  const result = parseResponsesResult(responseText);
  if (!result) return NextResponse.json({ error: `RightAPI 返回了无法解析的响应：${responseText.slice(0, 500)}` }, { status: 502 });

  const toolCall = result.output?.find((item) => item.type === "function_call");
  if (toolCall?.name === "analyze_player_round") {
    let args: { roundNumber?: number; steamId64?: string; reason?: string };
    try { args = JSON.parse(toolCall.arguments ?? "{}") as typeof args; } catch { return NextResponse.json({ error: "AI 返回了无效的深度分析参数。" }, { status: 502 }); }
    const round = baseResult?.parsedDemo?.rounds?.find((item) => item.number === args.roundNumber);
    const player = baseResult?.parsedDemo?.players?.find((item) => item.steamId64 === args.steamId64 && !item.isBot);
    if (!round || !player || !round.players?.some((item) => item.steamId64 === player.steamId64)) return NextResponse.json({ error: "AI 请求的玩家或回合不在当前比赛报告中，已拒绝执行。" }, { status: 422 });
    const demoPath = baseResult?.importedDemo?.demo?.demoPath;
    if (!demoPath) return NextResponse.json({ error: "当前比赛找不到可供深度分析的 Demo 文件。" }, { status: 409 });
    const jobId = `deep-v2-${body.baseAnalysisJobId}-${round.number}-${player.steamId64}`;
    const existing = await playerRoundAnalysisQueue.getJob(jobId);
    const mapName = baseResult?.parsedDemo?.mapName;
    if (!mapName) return NextResponse.json({ error: "地图信息不可用。" }, { status: 409 });
    const job = existing ?? await playerRoundAnalysisQueue.add("analyze-player-round", { baseAnalysisJobId: body.baseAnalysisJobId, demoPath, mapName, roundNumber: round.number, steamId64: player.steamId64 }, { jobId });
    return NextResponse.json({ action: "deep_analysis_started", deepAnalysisJobId: job.id, roundNumber: round.number, player: { name: player.name, steamId64: player.steamId64 }, reason: args.reason ?? "需要补充逐帧证据" }, { status: 202 });
  }

  if (toolCall) {
    let args: Record<string, unknown>;
    try { args = JSON.parse(toolCall.arguments ?? "{}") as Record<string, unknown>; } catch { return NextResponse.json({ error: "AI 返回了无效的工具参数。" }, { status: 502 }); }
    let toolResult: unknown;
    const deepAnalysis = (deepResult as { analysis?: DeepAnalysis } | undefined)?.analysis;
    if (toolCall.name === "find_player") {
      const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
      if (!query) return NextResponse.json({ error: "AI 未提供要查找的玩家。" }, { status: 422 });
      toolResult = { players: (baseResult?.parsedDemo?.players ?? []).filter((player) => !player.isBot && (player.name.toLowerCase().includes(query) || player.steamId64.includes(query))).map((player) => ({ name: player.name, steamId64: player.steamId64 })) };
    } else if (toolCall.name === "get_round_summary") {
      const roundNumber = typeof args.roundNumber === "number" ? args.roundNumber : NaN;
      const round = baseResult?.parsedDemo?.rounds?.find((item) => item.number === roundNumber);
      if (!round) return NextResponse.json({ error: "AI 请求的回合不在当前比赛报告中。" }, { status: 422 });
      toolResult = { round };
    } else if (toolCall.name === "compare_player_rounds") {
      const steamId64 = typeof args.steamId64 === "string" ? args.steamId64 : "";
      const fromRound = typeof args.fromRound === "number" ? args.fromRound : NaN;
      const toRound = typeof args.toRound === "number" ? args.toRound : NaN;
      const player = baseResult?.parsedDemo?.players?.find((item) => item.steamId64 === steamId64 && !item.isBot);
      if (!player || !Number.isInteger(fromRound) || !Number.isInteger(toRound) || fromRound > toRound) return NextResponse.json({ error: "AI 请求的玩家或回合范围无效。" }, { status: 422 });
      const rounds = (baseResult?.parsedDemo?.rounds ?? []).filter((round) => round.number >= fromRound && round.number <= toRound).map((round) => ({ roundNumber: round.number, winner: round.winner, player: round.players?.find((item) => item.steamId64 === steamId64) }));
      toolResult = { player: { name: player.name, steamId64 }, rounds };
    } else if (toolCall.name === "get_player_state_at_frame") {
      const frame = typeof args.frame === "number" ? args.frame : NaN;
      const samples = deepAnalysis?.samples ?? [];
      if (!Number.isInteger(frame) || samples.length === 0) toolResult = { available: false, reason: "当前没有可用的单回合深度分析；请先分析目标玩家与回合。" };
      else {
        const sample = samples.reduce((nearest, candidate) => Math.abs(candidate.frame - frame) < Math.abs(nearest.frame - frame) ? candidate : nearest);
        toolResult = { available: true, requestedFrame: frame, sample, frameOffset: sample.frame - frame, nearbyEvents: (deepAnalysis?.events ?? []).filter((event) => Math.abs(event.frame - sample.frame) <= 32) };
      }
    } else if (toolCall.name === "get_player_movement_segment") {
      const startFrame = typeof args.startFrame === "number" ? args.startFrame : NaN;
      const endFrame = typeof args.endFrame === "number" ? args.endFrame : NaN;
      const segment = (deepAnalysis?.samples ?? []).filter((sample) => sample.frame >= startFrame && sample.frame <= endFrame);
      if (!Number.isInteger(startFrame) || !Number.isInteger(endFrame) || startFrame > endFrame || segment.length === 0) toolResult = { available: false, reason: "该帧区间没有可用的深度采样；请先生成对应玩家与回合的深度分析。" };
      else {
        const speeds = segment.map((sample) => sample.speed);
        toolResult = { available: true, startFrame, endFrame, sampleCount: segment.length, start: segment[0], end: segment.at(-1), speed: { min: Math.min(...speeds), max: Math.max(...speeds), average: speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length }, combatEvents: (deepAnalysis?.events ?? []).filter((event) => event.frame >= startFrame && event.frame <= endFrame) };
      }
    } else if (toolCall.name === "get_player_loadout") {
      if (!deepAnalysis?.initialState) toolResult = { available: false, reason: "当前没有可用的单回合深度分析；请先分析目标玩家与回合。" };
      else toolResult = { available: true, roundNumber: deepAnalysis.roundNumber, initialState: deepAnalysis.initialState, weaponsObserved: [...new Set([deepAnalysis.initialState.weapon, ...(deepAnalysis.samples ?? []).map((sample) => sample.weapon), ...(deepAnalysis.events ?? []).map((event) => event.weapon)])].filter((weapon) => weapon && weapon !== "unknown") };
    } else if (toolCall.name === "get_weapon_profile") {
      const weapon = typeof args.weapon === "string" ? args.weapon : "";
      const profile = WEAPON_PROFILES[weaponKey(weapon)];
      toolResult = profile ? { available: true, source: "内置 CS2 常用武器资料库；静态数值会随版本平衡调整", profile } : { available: false, weapon, reason: "当前内置资料库未收录该武器。" };
    } else if (toolCall.name === "get_player_position_at_frame" || toolCall.name === "get_player_aim_at_frame" || toolCall.name === "get_aim_targeting_at_frame") {
      const frame = typeof args.frame === "number" ? args.frame : NaN;
      const samples = deepAnalysis?.samples ?? [];
      if (!Number.isInteger(frame) || samples.length === 0) toolResult = { available: false, reason: "当前没有可用的单回合深度分析；请先分析目标玩家与回合。" };
      else {
        const sample = nearestSample(samples, frame);
        const common = { available: true, requestedFrame: frame, sampledFrame: sample.frame, frameOffset: sample.frame - frame, position: { x: sample.x, y: sample.y, z: sample.z }, speed: sample.speed, health: sample.health, armor: sample.armor, weapon: sample.weapon, nearbyEvents: (deepAnalysis?.events ?? []).filter((event) => Math.abs(event.frame - sample.frame) <= 32) };
        if (toolCall.name === "get_player_aim_at_frame") toolResult = { ...common, viewAngles: { yaw: sample.yaw, pitch: sample.pitch }, viewDirection: viewDirection(sample.yaw, sample.pitch), limitation: "这是视角/准星朝向推断；尚无地图碰撞体、雷达标定与敌人骨骼射线检测，不能确定准星精确落点。" };
        else if (toolCall.name === "get_aim_targeting_at_frame") {
          const opponents = (deepAnalysis?.opponentSamples ?? []).filter((opponent) => opponent.frame === sample.frame);
          toolResult = { ...common, viewAngles: { yaw: sample.yaw, pitch: sample.pitch }, candidates: aimRayCandidates(sample, opponents).slice(0, 5), limitation: "候选结果使用敌人身体胶囊近似；目前未读取地图 VPK 中的碰撞体，不能确认两者之间没有墙体或道具遮挡。" };
        } else toolResult = common;
      }
    } else if (toolCall.name === "get_map_info") {
      const match = baseResult?.parsedDemo;
      toolResult = { mapName: match?.mapName, tickRate: match?.tickRate, totalFrames: match?.totalFrames, roundCount: match?.rounds?.length ?? 0, playerCount: match?.players?.filter((player) => !player.isBot).length ?? 0, coordinateSystem: "玩家坐标为 Demo 世界坐标；目前尚未完成到雷达图、地图点位名或碰撞体的标定。" };
    } else {
      return NextResponse.json({ error: "AI 请求了未允许的工具。" }, { status: 422 });
    }

    const followUp = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, store: false, stream: false, reasoning: { effort: "medium" }, input: [
        { role: "system", content: "你是 CS2 赛后复盘教练。依据比赛证据和工具返回结果回答。不要猜测；结论必须指出回合、玩家、帧或事件。若工具结果表明无法唯一定位玩家，先请求用户明确玩家。用简洁中文。" },
        { role: "system", content: "当工具返回准星/视角数据时，只能评价视角朝向、速度与交火时机；没有地图碰撞体、雷达标定和敌人骨骼射线检测时，不得断言准星精确落在敌人头部、墙角或具体点位。" },
        { role: "system", content: `比赛证据：${evidence}` },
        { role: "system", content: `工具 ${toolCall.name} 返回：${JSON.stringify(toolResult)}` },
        { role: "user", content: body.message },
      ] }),
    });
    const followUpText = await followUp.text();
    if (!followUp.ok) return NextResponse.json({ error: `RightAPI 工具续问失败：${followUp.status} ${followUpText || "（响应为空）"}` }, { status: 502 });
    const followUpResult = parseResponsesResult(followUpText);
    const followUpAnswer = followUpResult?.output_text ?? followUpResult?.output?.flatMap((item) => item.content ?? []).map((content) => content.text ?? "").join("");
    if (!followUpAnswer) return NextResponse.json({ error: "AI 未能根据工具结果生成回答。" }, { status: 502 });
    return NextResponse.json({ answer: followUpAnswer, toolUsed: toolCall.name });
  }

  const answer = result.output_text ?? result.output?.flatMap((item) => item.content ?? []).map((content) => content.text ?? "").join("");
  if (!answer) return NextResponse.json({ error: "RightAPI 未返回可用回答。" }, { status: 502 });
  return NextResponse.json({ answer });
}
