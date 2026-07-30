export const DEMO_ANALYSIS_QUEUE = "demo-analysis";
export const PLAYER_ROUND_ANALYSIS_QUEUE = "player-round-analysis";

export interface DemoAnalysisJob {
  demoAssetId: string;
  matchId: string;
  requestedByUserId: string;
  source: {
    originalFilename: string;
    storedPath: string;
    mediaType: string;
  };
}

export interface PlayerRoundAnalysisJob {
  baseAnalysisJobId: string;
  demoPath: string;
  roundNumber: number;
  steamId64: string;
}
