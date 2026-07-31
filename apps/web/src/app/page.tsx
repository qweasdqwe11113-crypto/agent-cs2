"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

const workflow = ["上传 Wmpvp ZIP 或 .dem", "解析比赛事件", "生成关键回合与中文复盘"];

type Team = "T" | "CT" | "spectator" | "unassigned" | `unknown:${number}`;

interface ParsedPlayer {
  steamId64: string;
  name: string;
  team: Team;
  isBot: boolean;
}

interface ParsedRound {
  number: number;
  endFrame: number;
  winner: Team;
  endReason: string;
  message: string;
  players: RoundPlayer[];
}

interface RoundPlayer {
  steamId64: string;
  name: string;
  team: Team;
  kills: number;
  deaths: number;
  assists: number;
  headshots: number;
  events: PlayerEvent[];
}

interface PlayerEvent {
  frame: number;
  type: "kill" | "death" | "assist";
  counterpart: string;
  weapon: string;
  isHeadshot: boolean;
}

interface ParsedDemo {
  mapName: string;
  tickRate: number;
  totalFrames: number;
  players: ParsedPlayer[];
  rounds: ParsedRound[];
}

interface AnalysisResult {
  status: "parsed";
  parsedDemo: ParsedDemo;
}

interface TaskResponse {
  id: string;
  state: string;
  progress: number | object;
  failedReason?: string;
  result?: AnalysisResult;
  error?: string;
}

interface DeepTaskResponse {
  id: string;
  state: string;
  progress: number | object;
  failedReason?: string;
  result?: { analysis: { summary: { shotsFired: number; damageDealt: number; damageTaken: number; movingShots: number }; initialState?: { frame: number; health: number; armor: number; money: number; equipmentValue: number; weapon: string }; freezeTimeEndFrame?: number; roundTimeSeconds?: number; samples: Array<{ frame: number; x: number; y: number; z: number; yaw: number; pitch: number; speed: number; health: number; armor: number; weapon: string; radar?: { x: number; y: number }; callout?: string }>; events: Array<{ frame: number; type: string; opponent: string; weapon: string; damage: number; speed: number; stopStatus?: string; confidence?: string }> } };
}

function taskStateText(state: string): string {
  const labels: Record<string, string> = {
    waiting: "等待 Worker 处理",
    active: "正在分析",
    completed: "分析完成",
    failed: "分析失败",
    delayed: "等待重试",
  };
  return labels[state] ?? state;
}

function roundReason(round: ParsedRound): string {
  const messages: Record<string, string> = {
    "#SFUI_Notice_Bomb_Defused": "炸弹已拆除",
    "#SFUI_Notice_Target_Bombed": "炸弹爆炸",
    "#SFUI_Notice_CTs_Win": "CT 胜利",
    "#SFUI_Notice_Terrorists_Win": "T 胜利",
  };
  return messages[round.message] ?? `结束原因 ${round.endReason}`;
}

function playerEventText(event: PlayerEvent): string {
  const labels: Record<PlayerEvent["type"], string> = {
    kill: "击杀",
    death: "被击杀",
    assist: "助攻",
  };
  const headshot = event.isHeadshot ? " · 爆头" : "";
  return `${labels[event.type]} ${event.counterpart} · ${event.weapon}${headshot}`;
}

function deepEventText(event: NonNullable<DeepTaskResponse["result"]>["analysis"]["events"][number]): string {
  const labels: Record<string, string> = { shot: "开火", damage_dealt: "造成伤害", damage_taken: "受到伤害", kill: "击杀", death: "死亡" };
  return `${labels[event.type] ?? event.type}${event.opponent ? ` · ${event.opponent}` : ""}${event.weapon ? ` · ${event.weapon}` : ""}`;
}

function buildDuels(events: NonNullable<DeepTaskResponse["result"]>["analysis"]["events"]) {
  const duels: Array<{ opponent: string; startFrame: number; endFrame: number; shots: typeof events; dealt: number; taken: number; outcome: string }> = [];
  for (const event of events.filter((item) => item.opponent && item.opponent !== "world")) {
    const previous = duels.at(-1);
    if (previous !== undefined && previous.opponent === event.opponent && event.frame - previous.endFrame <= 192) {
      previous.shots.push(event); previous.endFrame = event.frame;
      previous.dealt += event.type === "damage_dealt" ? event.damage : 0;
      previous.taken += event.type === "damage_taken" ? event.damage : 0;
      if (event.type === "kill") previous.outcome = "击杀对手";
      if (event.type === "death") previous.outcome = "被对手击杀";
    } else {
      duels.push({ opponent: event.opponent, startFrame: event.frame, endFrame: event.frame, shots: [event], dealt: event.type === "damage_dealt" ? event.damage : 0, taken: event.type === "damage_taken" ? event.damage : 0, outcome: event.type === "kill" ? "击杀对手" : event.type === "death" ? "被对手击杀" : "交火结束" });
    }
  }
  return duels;
}

function RadarTrajectory({ samples, events }: { samples: NonNullable<DeepTaskResponse["result"]>["analysis"]["samples"]; events: NonNullable<DeepTaskResponse["result"]>["analysis"]["events"] }) {
  const points = samples.filter((sample): sample is typeof sample & { radar: { x: number; y: number } } => sample.radar !== undefined);
  if (points.length < 2) return null;
  const firstPoint = points[0]!;
  const lastPoint = points.at(-1)!;
  const stride = Math.max(1, Math.ceil(points.length / 500));
  const path = points.filter((_, index) => index % stride === 0).map((sample) => `${sample.radar.x},${sample.radar.y}`).join(" ");
  const eventPoints = events.filter((event) => ["shot", "damage_dealt", "damage_taken", "kill", "death"].includes(event.type)).map((event) => ({ event, sample: points.reduce((nearest, sample) => Math.abs(sample.frame - event.frame) < Math.abs(nearest.frame - event.frame) ? sample : nearest) }));
  return <section className="radar-trajectory"><div className="radar-heading"><div><h4>回合轨迹雷达</h4><p className="hint">绿色为移动轨迹；圆点为开火、伤害与击杀等关键事件。</p></div></div><div className="radar-canvas"><img src="/maps/de_mirage/radar.png" alt="Mirage 雷达图" /><svg viewBox="0 0 1024 1024" aria-label="玩家轨迹"><polyline points={path} className="radar-path" />{eventPoints.map(({ event, sample }, index) => <circle key={`${event.frame}-${index}`} cx={sample.radar.x} cy={sample.radar.y} r={event.type === "kill" || event.type === "death" ? 13 : 8} className={`radar-event radar-event-${event.type}`}><title>帧 {event.frame} · {deepEventText(event)}</title></circle>)}<circle cx={firstPoint.radar.x} cy={firstPoint.radar.y} r="10" className="radar-start"><title>回合起点</title></circle><circle cx={lastPoint.radar.x} cy={lastPoint.radar.y} r="10" className="radar-end"><title>回合终点</title></circle></svg></div><div className="radar-legend"><span><i className="legend-start" />起点</span><span><i className="legend-path" />轨迹</span><span><i className="legend-event" />关键事件</span><span><i className="legend-end" />终点</span></div></section>;
}

function referencedRadarFrames(answer: string | null) {
  if (!answer) return [];
  const frames = [...answer.matchAll(/\[\[RADAR_FRAME:\s*(\d+)\]\]|(?:雷达帧|帧)\s*[:：]?\s*(\d+)/g)]
    .map((match) => Number(match[1] ?? match[2]))
    .filter((frame) => Number.isInteger(frame) && frame >= 0);
  return [...new Set(frames)].slice(0, 3);
}

function cleanCoachAnswer(answer: string, firstFrame: number | undefined, tickRate: number) {
  const withoutTokens = answer.replace(/\s*\[\[RADAR_FRAME:\s*\d+\]\]/g, "");
  if (firstFrame === undefined) return withoutTokens;
  // Guardrail for a provider that ignores the prompt and exposes a raw frame.
  return withoutTokens.replace(/(?:第\s*)?(\d+)\s*帧/g, (_match, frameText: string) => `本回合 ${formatRoundElapsed(Number(frameText), firstFrame, tickRate)}`);
}

function formatRoundElapsed(frame: number, firstFrame: number, tickRate: number) {
  const elapsedSeconds = Math.max(0, (frame - firstFrame) / Math.max(1, tickRate));
  const minutes = Math.floor(elapsedSeconds / 60);
  return `${minutes}:${(elapsedSeconds % 60).toFixed(1).padStart(4, "0")}`;
}

function formatElapsedInput(elapsedSeconds: number) {
  const minutes = Math.floor(elapsedSeconds / 60);
  return `${minutes}:${(elapsedSeconds % 60).toFixed(1).padStart(4, "0")}`;
}

function parseRoundClock(value: string) {
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  const match = trimmed.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
  if (!match) return undefined;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds >= 60) return undefined;
  return minutes * 60 + seconds;
}

function RadarEvidenceCard({ frame, samples, events, tickRate }: { frame: number; samples: NonNullable<DeepTaskResponse["result"]>["analysis"]["samples"]; events: NonNullable<DeepTaskResponse["result"]>["analysis"]["events"]; tickRate: number }) {
  const points = samples.filter((sample): sample is typeof sample & { radar: { x: number; y: number } } => sample.radar !== undefined);
  if (points.length === 0) return null;
  const selected = points.reduce((nearest, sample) => Math.abs(sample.frame - frame) < Math.abs(nearest.frame - frame) ? sample : nearest);
  const roundElapsed = formatRoundElapsed(selected.frame, points[0]!.frame, tickRate);
  const windowStart = selected.frame - 192;
  const windowEnd = selected.frame + 192;
  const windowPoints = points.filter((sample) => sample.frame >= windowStart && sample.frame <= windowEnd);
  const stride = Math.max(1, Math.ceil(windowPoints.length / 180));
  const path = windowPoints.filter((_, index) => index % stride === 0).map((sample) => `${sample.radar.x},${sample.radar.y}`).join(" ");
  const nearbyEvents = events.filter((event) => event.frame >= windowStart && event.frame <= windowEnd).map((event) => ({ event, sample: points.reduce((nearest, sample) => Math.abs(sample.frame - event.frame) < Math.abs(nearest.frame - event.frame) ? sample : nearest) }));
  const yawRadians = selected.yaw * Math.PI / 180;
  const arrowX = selected.radar.x + Math.cos(yawRadians) * 46;
  const arrowY = selected.radar.y - Math.sin(yawRadians) * 46;
  return <article className="radar-evidence-card">
    <div className="radar-evidence-heading"><strong>雷达证据 · 本回合 {roundElapsed}</strong><span>{selected.frame === frame ? "AI 引用时刻" : "引用时刻附近"}</span></div>
    <div className="radar-evidence-map"><img src="/maps/de_mirage/radar.png" alt={`帧 ${selected.frame} 的 Mirage 雷达位置`} /><svg viewBox="0 0 1024 1024" aria-label="AI 引用位置"><polyline points={path} className="radar-evidence-path" />{nearbyEvents.map(({ event, sample }, index) => <circle key={`${event.frame}-${index}`} cx={sample.radar.x} cy={sample.radar.y} r="7" className={`radar-event radar-event-${event.type}`}><title>帧 {event.frame} · {deepEventText(event)}</title></circle>)}<line x1={selected.radar.x} y1={selected.radar.y} x2={arrowX} y2={arrowY} className="radar-evidence-heading-arrow" /><circle cx={selected.radar.x} cy={selected.radar.y} r="13" className="radar-evidence-position" /></svg></div>
    <div className="radar-evidence-meta"><span>雷达 {Math.round(selected.radar.x)}, {Math.round(selected.radar.y)}</span><span>Z 高度 {Math.round(selected.z)}</span><span>{selected.speed.toFixed(0)} u/s · {selected.weapon}</span>{selected.callout ? <span>图片点位近似：{selected.callout}</span> : <span>图片点位：未标注</span>}</div>
    <p className="hint">展示该帧前后约 3 秒二维轨迹；箭头为玩家平面朝向，点位名称仅作图片区域近似。</p>
  </article>;
}

export default function HomePage() {
  const [status, setStatus] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [task, setTask] = useState<TaskResponse | null>(null);
  const [selectedRoundNumber, setSelectedRoundNumber] = useState<number | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [deepTask, setDeepTask] = useState<DeepTaskResponse | null>(null);
  const [question, setQuestion] = useState("");
  const [chatAnswer, setChatAnswer] = useState<string | null>(null);
  const [isAsking, setIsAsking] = useState(false);
  const [pendingCoachQuestion, setPendingCoachQuestion] = useState<string | null>(null);
  const [threeDimensionalMapEnabled, setThreeDimensionalMapEnabled] = useState(false);
  const [requestedRoundClock, setRequestedRoundClock] = useState("");
  const [requestedRadarFrame, setRequestedRadarFrame] = useState<number | null>(null);
  const [requestedRadarError, setRequestedRadarError] = useState<string | null>(null);

  useEffect(() => {
    const savedJobId = window.localStorage.getItem("latest-demo-analysis-job");
    if (savedJobId !== null) setJobId(savedJobId);
  }, []);

  useEffect(() => {
    if (jobId === null) return;
    const activeJobId = jobId;

    let disposed = false;
    async function poll() {
      try {
        const response = await fetch(`/api/demos?jobId=${encodeURIComponent(activeJobId)}`, { cache: "no-store" });
        const result = (await response.json()) as TaskResponse;
        if (!response.ok) throw new Error(result.error ?? "无法获取任务状态。");
        if (!disposed) setTask(result);
      } catch (error) {
        if (!disposed) setStatus(error instanceof Error ? error.message : "无法获取任务状态。");
      }
    }

    void poll();
    const intervalId = window.setInterval(poll, 2_000);
    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [jobId]);

  useEffect(() => {
    if (deepTask === null || ["completed", "failed"].includes(deepTask.state)) return;
    const id = window.setInterval(async () => {
      const response = await fetch(`/api/deep-analysis?jobId=${encodeURIComponent(deepTask.id)}`, { cache: "no-store" });
      if (response.ok) setDeepTask(await response.json() as DeepTaskResponse);
    }, 2_000);
    return () => window.clearInterval(id);
  }, [deepTask]);

  useEffect(() => {
    if (deepTask?.state !== "completed" || pendingCoachQuestion === null) return;
    const pendingQuestion = pendingCoachQuestion;
    setPendingCoachQuestion(null);
    void requestCoach(pendingQuestion, deepTask.id);
  }, [deepTask, pendingCoachQuestion]);

  async function startDeepAnalysis() {
    if (!jobId || !selectedRound || !selectedPlayer) return;
    const response = await fetch("/api/deep-analysis", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ baseAnalysisJobId: jobId, roundNumber: selectedRound.number, steamId64: selectedPlayer.steamId64 }) });
    const payload = await response.json() as { jobId?: string; error?: string };
    if (!response.ok || !payload.jobId) { setStatus(payload.error ?? "无法创建深度分析任务。"); return; }
    setRequestedRadarFrame(null);
    setRequestedRadarError(null);
    setDeepTask({ id: payload.jobId, state: "waiting", progress: 0 });
  }
  async function requestCoach(message: string, deepAnalysisJobId = deepTask?.id) {
    if (!jobId) return;
    setIsAsking(true); setChatAnswer(null);
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, baseAnalysisJobId: jobId, deepAnalysisJobId, threeDimensionalMapEnabled }) });
      const responseText = await response.text();
      let payload: { answer?: string; error?: string; action?: string; deepAnalysisJobId?: string; roundNumber?: number; player?: { name: string; steamId64: string }; reason?: string };
      try { payload = JSON.parse(responseText) as typeof payload; } catch { throw new Error(`聊天服务返回了非 JSON 内容（HTTP ${response.status}）：${responseText.slice(0, 300) || "响应为空"}`); }
      if (payload.action === "deep_analysis_started" && payload.deepAnalysisJobId && payload.player && payload.roundNumber) {
        setSelectedRoundNumber(payload.roundNumber);
        setSelectedPlayerId(payload.player.steamId64);
        setDeepTask({ id: payload.deepAnalysisJobId, state: "waiting", progress: 0 });
        setPendingCoachQuestion(message);
        setChatAnswer(`AI 正在分析 ${payload.player.name} 的第 ${payload.roundNumber} 回合（${payload.reason ?? "补充交火证据"}）。完成后会自动继续回答。`);
        return;
      }
      if (!response.ok || !payload.answer) throw new Error(payload.error ?? "教练暂时无法回答。");
      setChatAnswer(payload.answer);
    } catch (error) { setChatAnswer(error instanceof Error ? error.message : "教练暂时无法回答。"); } finally { setIsAsking(false); }
  }

  async function askCoach(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!jobId || !question.trim()) return;
    await requestCoach(question);
  }

  const parsedDemo = task?.state === "completed" ? task.result?.parsedDemo : undefined;
  const score = useMemo(() => {
    if (parsedDemo === undefined) return { t: 0, ct: 0 };
    return parsedDemo.rounds.reduce(
      (current, round) => ({
        t: current.t + (round.winner === "T" ? 1 : 0),
        ct: current.ct + (round.winner === "CT" ? 1 : 0),
      }),
      { t: 0, ct: 0 },
    );
  }, [parsedDemo]);
  const hasRoundPlayerDetails =
    parsedDemo !== undefined && parsedDemo.rounds.every((round) => Array.isArray(round.players));
  const selectedRound = parsedDemo?.rounds.find((round) => round.number === selectedRoundNumber);
  const selectablePlayers = parsedDemo?.players.filter((player) => !player.isBot && player.steamId64 !== "0") ?? [];
  const selectedPlayer = selectablePlayers.find((player) => player.steamId64 === selectedPlayerId);
  const selectedPlayerRound = (selectedRound?.players ?? []).find((player) => player.steamId64 === selectedPlayerId);
  const deepAnalysis = deepTask?.state === "completed" ? deepTask.result?.analysis : undefined;
  const coachingInsights = deepAnalysis === undefined ? [] : [
    ...(deepAnalysis.summary.movingShots > 0 ? [`有 ${deepAnalysis.summary.movingShots} 次明显移动开火；优先练习 peek 后反向急停，再打第一发。`] : ["本回合未检测到明显高速移动开火。"]),
    ...(deepAnalysis.summary.damageTaken > deepAnalysis.summary.damageDealt ? ["承受伤害高于造成伤害；交火前应更重视掩体、预瞄和队友补枪距离。"] : []),
    ...(deepAnalysis.summary.shotsFired > 0 && deepAnalysis.summary.damageDealt === 0 ? ["有开火但未造成伤害；建议复盘首个交火点的预瞄高度与第一发时机。"] : []),
  ];
  const duels = deepAnalysis === undefined ? [] : buildDuels(deepAnalysis.events);
  const coachRadarFrames = referencedRadarFrames(chatAnswer);
  const roundTime = (frame: number) => formatRoundElapsed(frame, deepAnalysis?.samples[0]?.frame ?? frame, parsedDemo?.tickRate ?? 64);
  const manualRadarFirstFrame = deepAnalysis?.samples[0]?.frame;
  const manualRadarLastFrame = deepAnalysis?.samples.at(-1)?.frame;
  const manualRadarMaxElapsedSeconds = manualRadarFirstFrame === undefined || manualRadarLastFrame === undefined
    ? 0
    : (manualRadarLastFrame - manualRadarFirstFrame) / (parsedDemo?.tickRate ?? 64);

  function setRequestedRadarAtElapsedSeconds(elapsedSeconds: number) {
    if (!deepAnalysis || manualRadarFirstFrame === undefined) {
      setRequestedRadarError("当前深度分析没有可用的位置采样，请重新生成深度分析。");
      return;
    }
    const clampedSeconds = Math.max(0, Math.min(manualRadarMaxElapsedSeconds, elapsedSeconds));
    setRequestedRoundClock(formatElapsedInput(clampedSeconds));
    setRequestedRadarError(null);
    setRequestedRadarFrame(Math.round(manualRadarFirstFrame + clampedSeconds * (parsedDemo?.tickRate ?? 64)));
  }

  function showRequestedRadarFrame(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deepAnalysis || deepAnalysis.samples.length === 0) {
      setRequestedRadarError("当前深度分析没有可用的位置采样，请重新生成深度分析。");
      return;
    }
    const elapsedSeconds = parseRoundClock(requestedRoundClock);
    const firstFrame = deepAnalysis.samples[0]!.frame;
    const lastFrame = deepAnalysis.samples.at(-1)!.frame;
    const maxElapsedSeconds = (lastFrame - firstFrame) / (parsedDemo?.tickRate ?? 64);
    if (elapsedSeconds === undefined || elapsedSeconds < 0 || elapsedSeconds > maxElapsedSeconds) {
      setRequestedRadarFrame(null);
      setRequestedRadarError(`请输入有效经过时间（0:00.0 至 ${formatRoundElapsed(lastFrame, firstFrame, parsedDemo?.tickRate ?? 64)}）。`);
      return;
    }
    setRequestedRadarAtElapsedSeconds(elapsedSeconds);
  }

  async function submitDemo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get("demo");

    if (!(file instanceof File) || file.size === 0) {
      setStatus("请选择一个 ZIP 或 .dem 文件。");
      return;
    }

    setIsUploading(true);
    setStatus("正在上传并创建分析任务…");

    try {
      const response = await fetch("/api/demos", { method: "POST", body: new FormData(form) });
      const result = (await response.json()) as { error?: string; jobId?: string };

      if (!response.ok || result.error === undefined && result.jobId === undefined) {
        throw new Error(result.error ?? "无法创建分析任务。");
      }

      setStatus(`上传完成，分析任务已创建：${result.jobId}`);
      setTask(null);
      setJobId(result.jobId ?? null);
      setSelectedRoundNumber(null);
      setSelectedPlayerId(null);
      if (result.jobId !== undefined) window.localStorage.setItem("latest-demo-analysis-job", result.jobId);
      form.reset();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "上传失败，请重试。");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <main>
      <p className="eyebrow">CS2 DEMO ANALYSIS</p>
      <h1>上传一局回放，获得可验证的赛后复盘。</h1>
      <p className="lead">上传完美世界竞技平台回放，系统会解析对局并显示逐回合赛果。</p>
      <ol>
        {workflow.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>
      <form className="upload-form" onSubmit={submitDemo}>
        <label htmlFor="demo">选择完美世界竞技平台回放</label>
        <input id="demo" name="demo" type="file" accept=".zip,.dem,application/zip" required />
        <button disabled={isUploading} type="submit">
          {isUploading ? "上传中…" : "上传并开始分析"}
        </button>
        {status !== null ? <p aria-live="polite" className="status">{status}</p> : null}
      </form>

      {task !== null ? (
        <section className="report" aria-live="polite">
          <div className="report-heading">
            <div>
              <p className="eyebrow">ANALYSIS TASK #{task.id}</p>
              <h2>{taskStateText(task.state)}</h2>
            </div>
            <span className={`task-state task-state-${task.state}`}>{taskStateText(task.state)}</span>
          </div>

          {task.state !== "completed" && task.state !== "failed" ? <p>当前进度：{String(task.progress)}%</p> : null}
          {task.state === "failed" ? <p className="error">{task.failedReason ?? "分析任务失败。"}</p> : null}

          {parsedDemo !== undefined ? (
            <>
              <div className="match-summary">
                <div><span>地图</span><strong>{parsedDemo.mapName || "未知地图"}</strong></div>
                <div><span>比分</span><strong>T {score.t} : {score.ct} CT</strong></div>
                <div><span>Tick Rate</span><strong>{parsedDemo.tickRate}</strong></div>
                <div><span>回合</span><strong>{parsedDemo.rounds.length}</strong></div>
              </div>

              <h3>玩家</h3>
              <div className="player-list">
                {parsedDemo.players.map((player) => (
                  <div className="player" key={`${player.steamId64}-${player.name}`}>
                    <strong>{player.name || "未知玩家"}</strong>
                    <span>{player.isBot ? "CSTV / Bot" : player.team} · {player.steamId64}</span>
                  </div>
                ))}
              </div>

              <h3>逐回合信息</h3>
              {hasRoundPlayerDetails ? (
                <p className="hint">选择一回合，再选择一名玩家，即可查看该回合的个人事件。</p>
              ) : (
                <p className="error">这份报告由旧版 parser 生成，未包含玩家级事件。请重新上传 demo 生成新版报告。</p>
              )}
              <div className="round-table-wrap">
                <table>
                  <thead><tr><th>回合</th><th>胜方</th><th>结束原因</th><th>结束帧</th><th>详情</th></tr></thead>
                  <tbody>
                    {parsedDemo.rounds.map((round) => (
                      <tr className={selectedRoundNumber === round.number ? "selected-round" : undefined} key={round.number}>
                        <td>#{round.number}</td>
                        <td><span className={round.winner === "T" ? "team-t" : "team-ct"}>{round.winner}</span></td>
                        <td>{roundReason(round)}</td>
                        <td>{round.endFrame}</td>
                        <td>{hasRoundPlayerDetails ? <button className="round-button" onClick={() => { setSelectedRoundNumber(round.number); setSelectedPlayerId(null); }} type="button">查看</button> : "需重新解析"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {hasRoundPlayerDetails && selectedRound !== undefined ? (
                <section className="round-detail">
                  <div className="round-detail-heading">
                    <div>
                      <p className="eyebrow">ROUND #{selectedRound.number}</p>
                      <h3>选择玩家查看本回合详情</h3>
                    </div>
                    <span>{selectedRound.winner} 胜 · {roundReason(selectedRound)}</span>
                  </div>
                  <div className="player-selector">
                    {selectablePlayers.map((player) => (
                      <button
                        className={selectedPlayerId === player.steamId64 ? "selected-player" : undefined}
                        key={player.steamId64}
                        onClick={() => { setSelectedPlayerId(player.steamId64); setDeepTask(null); }}
                        type="button"
                      >
                        {player.name} <small>{player.team}</small>
                      </button>
                    ))}
                  </div>

                  {selectedPlayer !== undefined ? (
                    <div className="player-detail">
                      <h4>{selectedPlayer.name} · 第 {selectedRound.number} 回合</h4>
                      <div className="player-stats">
                        <div><span>击杀</span><strong>{selectedPlayerRound?.kills ?? 0}</strong></div>
                        <div><span>死亡</span><strong>{selectedPlayerRound?.deaths ?? 0}</strong></div>
                        <div><span>助攻</span><strong>{selectedPlayerRound?.assists ?? 0}</strong></div>
                        <div><span>爆头</span><strong>{selectedPlayerRound?.headshots ?? 0}</strong></div>
                      </div>
                      <h4>事件时间线</h4>
                      {selectedPlayerRound !== undefined && selectedPlayerRound.events.length > 0 ? (
                        <ol className="event-list">
                          {selectedPlayerRound.events.map((event, index) => (
                            <li key={`${event.frame}-${event.type}-${index}`}><strong>帧 {event.frame}</strong> · {playerEventText(event)}</li>
                          ))}
                        </ol>
                      ) : <p className="hint">该玩家本回合没有击杀、死亡或助攻事件。</p>}
                      <button className="deep-analysis-button" onClick={() => void startDeepAnalysis()} type="button">开始生成深度指导分析</button>
                      {deepTask !== null ? <section className="deep-result"><h4>{taskStateText(deepTask.state)}</h4>{deepAnalysis ? <>
                        {deepAnalysis.initialState ? <><h4>回合概览</h4><div className="player-stats"><div><span>起始血甲</span><strong>{deepAnalysis.initialState.health} / {deepAnalysis.initialState.armor}</strong></div><div><span>现金</span><strong>${deepAnalysis.initialState.money}</strong></div><div><span>装备价值</span><strong>${deepAnalysis.initialState.equipmentValue}</strong></div><div><span>主武器</span><strong>{deepAnalysis.initialState.weapon}</strong></div></div></> : null}
                        <div className="player-stats"><div><span>开火</span><strong>{deepAnalysis.summary.shotsFired}</strong></div><div><span>移动开火</span><strong>{deepAnalysis.summary.movingShots}</strong></div><div><span>造成伤害</span><strong>{deepAnalysis.summary.damageDealt}</strong></div><div><span>承受伤害</span><strong>{deepAnalysis.summary.damageTaken}</strong></div></div>
                        <h4>路线与状态</h4><p className="hint">已按需采集 {deepAnalysis.samples.length} 个状态点。</p><RadarTrajectory samples={deepAnalysis.samples} events={deepAnalysis.events} />
                        <section className="manual-radar-evidence"><h4>指定时间雷达位置</h4><p className="hint">拖动进度条或输入本回合经过时间（例如 0:18.6 或 18.6），根据已解析的真实 Demo 坐标生成雷达图片。</p><div className="manual-radar-slider"><label htmlFor="requested-round-slider">0:00.0</label><input id="requested-round-slider" type="range" min="0" max={manualRadarMaxElapsedSeconds} step="0.1" value={Math.min(manualRadarMaxElapsedSeconds, Math.max(0, parseRoundClock(requestedRoundClock) ?? 0))} onChange={(event) => setRequestedRadarAtElapsedSeconds(Number(event.target.value))} /><label>{formatElapsedInput(manualRadarMaxElapsedSeconds)}</label></div><form onSubmit={showRequestedRadarFrame}><label htmlFor="requested-round-clock">回合经过时间</label><input id="requested-round-clock" value={requestedRoundClock} onChange={(event) => setRequestedRoundClock(event.target.value)} placeholder="0:18.6" inputMode="decimal" /><button type="submit">生成图片</button></form>{requestedRadarError ? <p className="error">{requestedRadarError}</p> : null}{requestedRadarFrame !== null ? <div className="radar-evidence-list"><RadarEvidenceCard frame={requestedRadarFrame} samples={deepAnalysis.samples} events={deepAnalysis.events} tickRate={parsedDemo?.tickRate ?? 64} /></div> : null}</section>
                        <h4>对枪卡片</h4>{duels.length > 0 ? <div className="duel-list">{duels.map((duel, index) => <article className="duel-card" key={`${duel.opponent}-${duel.startFrame}`}><strong>交火 {index + 1} · {duel.opponent}</strong><span>本回合 {roundTime(duel.startFrame)} – {roundTime(duel.endFrame)} · {duel.outcome}</span><div><b>造成伤害 {duel.dealt}</b><b>承受伤害 {duel.taken}</b></div><ol className="event-list">{duel.shots.map((event, eventIndex) => <li key={`${event.frame}-${eventIndex}`}><strong>本回合 {roundTime(event.frame)}</strong> · {deepEventText(event)}{event.type === "shot" ? ` · ${event.stopStatus} · ${event.speed.toFixed(1)} u/s` : ""}</li>)}</ol></article>)}</div> : <p className="hint">本回合未找到可归类的对手交火。</p>}
                        <details><summary>展开全部原始事件证据</summary><ol className="event-list">{deepAnalysis.events.map((event, index) => <li key={`${event.frame}-${index}`}><strong>本回合 {roundTime(event.frame)}</strong> · {deepEventText(event)} {event.type === "shot" ? `· ${event.stopStatus}（${event.confidence}）· 速度 ${event.speed.toFixed(1)}` : event.damage > 0 ? `· ${event.damage} 伤害` : ""}</li>)}</ol></details>
                        <h4>本回合训练建议</h4><ol className="event-list">{coachingInsights.map((insight) => <li key={insight}>{insight}</li>)}</ol>
                      </> : <p className="hint">任务正在排队或分析中；仅此玩家此回合会被重放解析。</p>}</section> : null}
                    </div>
                  ) : <p className="hint">请点击上方一名玩家。</p>}
                </section>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}
      <section className="coach-chat"><p className="eyebrow">AI COACH</p><h2>问比赛教练</h2><label className="map-detail-toggle"><input type="checkbox" checked={threeDimensionalMapEnabled} onChange={(event) => setThreeDimensionalMapEnabled(event.target.checked)} />启用 3D 地图分析（墙体遮挡、准星可见性、peek；默认关闭）</label><p className="hint">关闭时 AI 仅可使用二维雷达、z 高度层级与点位信息，不允许查询三维地图。</p><form onSubmit={askCoach}><textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="输入关于本局比赛的问题…" rows={3} /><button disabled={isAsking || jobId === null} type="submit">{isAsking ? "分析中…" : "提问"}</button></form>{chatAnswer ? <div className="chat-answer">{cleanCoachAnswer(chatAnswer, deepAnalysis?.samples[0]?.frame, parsedDemo?.tickRate ?? 64)}</div> : null}{deepAnalysis && coachRadarFrames.length > 0 ? <section className="coach-radar-evidence"><h3>AI 引用位置</h3><p className="hint">以下雷达卡由已解析的真实 Demo 坐标生成，不由 AI 绘制。</p><div className="radar-evidence-list">{coachRadarFrames.map((frame) => <RadarEvidenceCard key={frame} frame={frame} samples={deepAnalysis.samples} events={deepAnalysis.events} tickRate={parsedDemo?.tickRate ?? 64} />)}</div></section> : null}</section>
    </main>
  );
}
