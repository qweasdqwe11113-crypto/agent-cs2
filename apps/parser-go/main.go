package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"strconv"

	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs"
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/common"
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/events"
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/msg"
)

const schemaVersion = "v1"

type parseOutput struct {
	SchemaVersion string          `json:"schemaVersion"`
	SourcePath    string          `json:"sourcePath"`
	MapName       string          `json:"mapName"`
	TickRate      float64         `json:"tickRate"`
	TotalFrames   int             `json:"totalFrames"`
	Players       []playerSummary `json:"players"`
	Rounds        []roundSummary  `json:"rounds"`
}

type playerSummary struct {
	SteamID64 string `json:"steamId64"`
	Name      string `json:"name"`
	Team      string `json:"team"`
	IsBot     bool   `json:"isBot"`
}

type roundSummary struct {
	Number    int                  `json:"number"`
	EndFrame  int                  `json:"endFrame"`
	Winner    string               `json:"winner"`
	EndReason string               `json:"endReason"`
	Message   string               `json:"message"`
	Players   []roundPlayerSummary `json:"players"`
}

type roundPlayerSummary struct {
	SteamID64 string        `json:"steamId64"`
	Name      string        `json:"name"`
	Team      string        `json:"team"`
	Kills     int           `json:"kills"`
	Deaths    int           `json:"deaths"`
	Assists   int           `json:"assists"`
	Headshots int           `json:"headshots"`
	Events    []playerEvent `json:"events"`
}

type playerEvent struct {
	Frame       int    `json:"frame"`
	Type        string `json:"type"`
	Counterpart string `json:"counterpart"`
	Weapon      string `json:"weapon"`
	IsHeadshot  bool   `json:"isHeadshot"`
}

type roundAccumulator struct {
	summary roundSummary
	players map[string]*roundPlayerSummary
}

func main() {
	if len(os.Args) == 5 && os.Args[1] == "analyze-player-round" {
		roundNumber, parseErr := strconv.Atoi(os.Args[3])
		if parseErr != nil || roundNumber < 1 {
			fail(errors.New("round number must be a positive integer"))
		}
		result, err := analyzePlayerRound(os.Args[2], roundNumber, os.Args[4])
		if err != nil {
			fail(err)
		}
		if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
			fail(fmt.Errorf("encode analysis result: %w", err))
		}
		return
	}
	if len(os.Args) != 2 {
		fail(errors.New("usage: cs2-demo-parser <path-to-demo.dem>"))
	}

	result, err := parseDemo(os.Args[1])
	if err != nil {
		fail(err)
	}

	encoder := json.NewEncoder(os.Stdout)
	if err := encoder.Encode(result); err != nil {
		fail(fmt.Errorf("encode parse result: %w", err))
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}

func parseDemo(demoPath string) (result parseOutput, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("demo parser panic: %v", recovered)
		}
	}()

	file, err := os.Open(demoPath)
	if err != nil {
		return result, fmt.Errorf("open demo: %w", err)
	}
	defer file.Close()

	parser := demoinfocs.NewParser(file)
	defer parser.Close()

	result = parseOutput{
		SchemaVersion: schemaVersion,
		SourcePath:    demoPath,
		Players:       make([]playerSummary, 0),
		Rounds:        make([]roundSummary, 0),
	}

	parser.RegisterNetMessageHandler(func(serverInfo *msg.CSVCMsg_ServerInfo) {
		if result.MapName == "" {
			result.MapName = serverInfo.GetMapName()
		}
	})

	roundNumber := 0
	var activeRound *roundAccumulator
	parser.RegisterEventHandler(func(events.RoundStart) {
		roundNumber++
		activeRound = newRoundAccumulator(roundNumber)
	})
	parser.RegisterEventHandler(func(event events.Kill) {
		if activeRound == nil {
			return
		}
		activeRound.recordKill(event, parser.CurrentFrame())
	})
	parser.RegisterEventHandler(func(event events.RoundEnd) {
		if activeRound == nil {
			activeRound = newRoundAccumulator(roundNumber)
		}
		activeRound.summary.EndFrame = parser.CurrentFrame()
		activeRound.summary.Winner = teamName(event.Winner)
		activeRound.summary.EndReason = fmt.Sprint(event.Reason)
		activeRound.summary.Message = event.Message
		result.Rounds = append(result.Rounds, activeRound.result())
		activeRound = nil
	})

	if err := parser.ParseToEnd(); err != nil {
		return result, fmt.Errorf("parse demo: %w", err)
	}

	result.TickRate = parser.TickRate()
	result.TotalFrames = parser.CurrentFrame()
	for _, player := range parser.GameState().Participants().All() {
		result.Players = append(result.Players, playerSummary{
			SteamID64: fmt.Sprint(player.SteamID64),
			Name:      player.Name,
			Team:      teamName(player.Team),
			IsBot:     player.IsBot,
		})
	}
	sort.Slice(result.Players, func(i, j int) bool {
		return result.Players[i].Name < result.Players[j].Name
	})

	return result, nil
}

func newRoundAccumulator(number int) *roundAccumulator {
	return &roundAccumulator{
		summary: roundSummary{Number: number, Players: make([]roundPlayerSummary, 0)},
		players: make(map[string]*roundPlayerSummary),
	}
}

func (round *roundAccumulator) player(player *common.Player) *roundPlayerSummary {
	if player == nil {
		return nil
	}

	key := fmt.Sprint(player.SteamID64)
	if key == "0" {
		key = "name:" + player.Name
	}
	if existing, found := round.players[key]; found {
		return existing
	}

	created := &roundPlayerSummary{
		SteamID64: fmt.Sprint(player.SteamID64),
		Name:      player.Name,
		Team:      teamName(player.Team),
		Events:    make([]playerEvent, 0),
	}
	round.players[key] = created
	return created
}

func (round *roundAccumulator) recordKill(kill events.Kill, frame int) {
	weapon := "unknown"
	if kill.Weapon != nil {
		weapon = fmt.Sprint(kill.Weapon.Type)
	}

	if killer := round.player(kill.Killer); killer != nil {
		killer.Kills++
		if kill.IsHeadshot {
			killer.Headshots++
		}
		killer.Events = append(killer.Events, playerEvent{
			Frame: frame, Type: "kill", Counterpart: playerName(kill.Victim), Weapon: weapon, IsHeadshot: kill.IsHeadshot,
		})
	}
	if victim := round.player(kill.Victim); victim != nil {
		victim.Deaths++
		victim.Events = append(victim.Events, playerEvent{
			Frame: frame, Type: "death", Counterpart: playerName(kill.Killer), Weapon: weapon, IsHeadshot: kill.IsHeadshot,
		})
	}
	if assister := round.player(kill.Assister); assister != nil {
		assister.Assists++
		assister.Events = append(assister.Events, playerEvent{
			Frame: frame, Type: "assist", Counterpart: playerName(kill.Victim), Weapon: weapon, IsHeadshot: false,
		})
	}
}

func (round *roundAccumulator) result() roundSummary {
	for _, player := range round.players {
		round.summary.Players = append(round.summary.Players, *player)
	}
	sort.Slice(round.summary.Players, func(i, j int) bool {
		return round.summary.Players[i].Name < round.summary.Players[j].Name
	})
	return round.summary
}

func playerName(player *common.Player) string {
	if player == nil || player.Name == "" {
		return "world"
	}
	return player.Name
}

func teamName(team common.Team) string {
	switch team {
	case common.TeamTerrorists:
		return "T"
	case common.TeamCounterTerrorists:
		return "CT"
	case common.TeamSpectators:
		return "spectator"
	case common.TeamUnassigned:
		return "unassigned"
	default:
		return fmt.Sprintf("unknown:%d", team)
	}
}
