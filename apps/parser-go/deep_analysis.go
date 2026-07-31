package main

import (
	"fmt"
	"math"
	"os"
	"strings"

	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs"
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/common"
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/events"
)

type playerRoundAnalysis struct {
	SchemaVersion      string              `json:"schemaVersion"`
	RoundNumber        int                 `json:"roundNumber"`
	SteamID64          string              `json:"steamId64"`
	FreezeTimeEndFrame int                 `json:"freezeTimeEndFrame,omitempty"`
	RoundTimeSeconds   float64             `json:"roundTimeSeconds,omitempty"`
	InitialState       *initialState       `json:"initialState"`
	Samples            []stateSample       `json:"samples"`
	OpponentSamples    []opponentSample    `json:"opponentSamples"`
	OtherPlayerSamples []otherPlayerSample `json:"otherPlayerSamples"`
	Events             []deepEvent         `json:"events"`
	Summary            deepSummary         `json:"summary"`
}

type initialState struct {
	Frame          int    `json:"frame"`
	Health         int    `json:"health"`
	Armor          int    `json:"armor"`
	Money          int    `json:"money"`
	EquipmentValue int    `json:"equipmentValue"`
	Weapon         string `json:"weapon"`
}

type stateSample struct {
	Frame  int     `json:"frame"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Z      float64 `json:"z"`
	Speed  float64 `json:"speed"`
	Yaw    float32 `json:"yaw"`
	Pitch  float32 `json:"pitch"`
	Health int     `json:"health"`
	Armor  int     `json:"armor"`
	Weapon string  `json:"weapon"`
}

// opponentSample is collected only for the requested player-round. It enables
// later aim-ray checks without retaining every player's full-match tick data.
type opponentSample struct {
	Frame     int     `json:"frame"`
	SteamID64 string  `json:"steamId64"`
	Name      string  `json:"name"`
	X         float64 `json:"x"`
	Y         float64 `json:"y"`
	Z         float64 `json:"z"`
	Health    int     `json:"health"`
}

// otherPlayerSample is used only by the manually selected radar timestamp.
// It intentionally keeps position and team data only; the player's own
// trajectory remains the primary deep-analysis view.
type otherPlayerSample struct {
	Frame     int     `json:"frame"`
	SteamID64 string  `json:"steamId64"`
	Name      string  `json:"name"`
	Team      string  `json:"team"`
	X         float64 `json:"x"`
	Y         float64 `json:"y"`
	Z         float64 `json:"z"`
	Health    int     `json:"health"`
}

type deepEvent struct {
	Frame      int     `json:"frame"`
	Type       string  `json:"type"`
	Opponent   string  `json:"opponent"`
	Weapon     string  `json:"weapon"`
	Damage     int     `json:"damage"`
	Speed      float64 `json:"speed"`
	StopStatus string  `json:"stopStatus,omitempty"`
	Confidence string  `json:"confidence,omitempty"`
}

type deepSummary struct {
	ShotsFired  int `json:"shotsFired"`
	DamageDealt int `json:"damageDealt"`
	DamageTaken int `json:"damageTaken"`
	MovingShots int `json:"movingShots"`
}

func analyzePlayerRound(demoPath string, wantedRound int, steamID string) (result playerRoundAnalysis, err error) {
	file, err := os.Open(demoPath)
	if err != nil {
		return result, fmt.Errorf("open demo: %w", err)
	}
	defer file.Close()
	parser := demoinfocs.NewParser(file)
	defer parser.Close()
	result = playerRoundAnalysis{SchemaVersion: "v3", RoundNumber: wantedRound, SteamID64: steamID, Samples: []stateSample{}, OpponentSamples: []opponentSample{}, OtherPlayerSamples: []otherPlayerSample{}, Events: []deepEvent{}}
	round := 0
	active := false
	var previous *stateSample

	parser.RegisterEventHandler(func(events.RoundStart) {
		round++
		active = round == wantedRound
		if active {
			if player := playerBySteamID(parser, steamID); player != nil {
				result.InitialState = &initialState{Frame: parser.CurrentFrame(), Health: player.Health(), Armor: player.Armor(), Money: player.Money(), EquipmentValue: player.EquipmentValueRoundStart(), Weapon: activeWeaponName(player)}
			}
		}
	})
	parser.RegisterEventHandler(func(events.RoundEnd) {
		if round == wantedRound {
			active = false
		}
	})
	parser.RegisterEventHandler(func(events.RoundFreezetimeEnd) {
		if !active {
			return
		}
		result.FreezeTimeEndFrame = parser.CurrentFrame()
		if roundTime, rulesErr := parser.GameState().Rules().RoundTime(); rulesErr == nil {
			result.RoundTimeSeconds = roundTime.Seconds()
		}
	})
	parser.RegisterEventHandler(func(events.FrameDone) {
		if !active {
			return
		}
		player := playerBySteamID(parser, steamID)
		if player == nil {
			return
		}
		position := player.Position()
		sample := stateSample{Frame: parser.CurrentFrame(), X: position.X, Y: position.Y, Z: position.Z, Yaw: player.ViewDirectionX(), Pitch: player.ViewDirectionY(), Health: player.Health(), Armor: player.Armor(), Weapon: activeWeaponName(player)}
		if previous != nil {
			distance := math.Sqrt(math.Pow(sample.X-previous.X, 2) + math.Pow(sample.Y-previous.Y, 2))
			deltaFrames := sample.Frame - previous.Frame
			if deltaFrames > 0 {
				sample.Speed = distance * parser.TickRate() / float64(deltaFrames)
			}
		}
		result.Samples = append(result.Samples, sample)
		previous = &result.Samples[len(result.Samples)-1]
		for _, other := range parser.GameState().Participants().All() {
			if other == nil || isTarget(other, steamID) || !other.IsAlive() || other.IsUnknown {
				continue
			}
			otherPosition := other.Position()
			result.OtherPlayerSamples = append(result.OtherPlayerSamples, otherPlayerSample{Frame: parser.CurrentFrame(), SteamID64: fmt.Sprint(other.SteamID64), Name: other.Name, Team: teamName(other.Team), X: otherPosition.X, Y: otherPosition.Y, Z: otherPosition.Z, Health: other.Health()})
		}
		for _, opponent := range parser.GameState().Participants().All() {
			if opponent == nil || opponent.Team == player.Team || !opponent.IsAlive() || opponent.IsUnknown {
				continue
			}
			opponentPosition := opponent.Position()
			result.OpponentSamples = append(result.OpponentSamples, opponentSample{Frame: parser.CurrentFrame(), SteamID64: fmt.Sprint(opponent.SteamID64), Name: opponent.Name, X: opponentPosition.X, Y: opponentPosition.Y, Z: opponentPosition.Z, Health: opponent.Health()})
		}
	})
	parser.RegisterEventHandler(func(event events.WeaponFire) {
		if !active || !isTarget(event.Shooter, steamID) {
			return
		}
		if !isCombatWeapon(equipmentName(event.Weapon)) {
			return
		}
		speed := lastSpeed(result.Samples)
		status, confidence := stopStatus(speed)
		result.Events = append(result.Events, deepEvent{Frame: parser.CurrentFrame(), Type: "shot", Weapon: equipmentName(event.Weapon), Speed: speed, StopStatus: status, Confidence: confidence})
		result.Summary.ShotsFired++
		if speed > 80 {
			result.Summary.MovingShots++
		}
	})
	parser.RegisterEventHandler(func(event events.PlayerHurt) {
		if !active {
			return
		}
		if isTarget(event.Attacker, steamID) {
			result.Events = append(result.Events, deepEvent{Frame: parser.CurrentFrame(), Type: "damage_dealt", Opponent: playerName(event.Player), Weapon: equipmentName(event.Weapon), Damage: event.HealthDamageTaken})
			result.Summary.DamageDealt += event.HealthDamageTaken
		}
		if isTarget(event.Player, steamID) {
			result.Events = append(result.Events, deepEvent{Frame: parser.CurrentFrame(), Type: "damage_taken", Opponent: playerName(event.Attacker), Weapon: equipmentName(event.Weapon), Damage: event.HealthDamageTaken})
			result.Summary.DamageTaken += event.HealthDamageTaken
		}
	})
	parser.RegisterEventHandler(func(event events.Kill) {
		if !active {
			return
		}
		if isTarget(event.Killer, steamID) {
			result.Events = append(result.Events, deepEvent{Frame: parser.CurrentFrame(), Type: "kill", Opponent: playerName(event.Victim), Weapon: equipmentName(event.Weapon)})
		}
		if isTarget(event.Victim, steamID) {
			result.Events = append(result.Events, deepEvent{Frame: parser.CurrentFrame(), Type: "death", Opponent: playerName(event.Killer), Weapon: equipmentName(event.Weapon)})
		}
	})
	if err := parser.ParseToEnd(); err != nil {
		return result, fmt.Errorf("parse demo: %w", err)
	}
	return result, nil
}

func playerBySteamID(parser demoinfocs.Parser, wanted string) *common.Player {
	for _, player := range parser.GameState().Participants().All() {
		if fmt.Sprint(player.SteamID64) == wanted {
			return player
		}
	}
	return nil
}
func isTarget(player *common.Player, wanted string) bool {
	return player != nil && fmt.Sprint(player.SteamID64) == wanted
}
func activeWeaponName(player *common.Player) string { return equipmentName(player.ActiveWeapon()) }
func equipmentName(equipment *common.Equipment) string {
	if equipment == nil {
		return "unknown"
	}
	return fmt.Sprint(equipment.Type)
}

func isCombatWeapon(name string) bool {
	lowered := strings.ToLower(name)
	return !strings.Contains(lowered, "knife") && !strings.Contains(lowered, "c4") && !strings.Contains(lowered, "grenade")
}
func lastSpeed(samples []stateSample) float64 {
	if len(samples) == 0 {
		return 0
	}
	return samples[len(samples)-1].Speed
}
func stopStatus(speed float64) (string, string) {
	if speed <= 20 {
		return "stable", "high"
	}
	if speed <= 80 {
		return "settling", "medium"
	}
	return "moving", "high"
}
