from typing import List, Optional, Literal
from pydantic import BaseModel

Player = Literal["RED", "BLUE"]
BotLevel = Literal["normal", "strong"]


class Coord(BaseModel):
    row: int
    col: int


class Cell(BaseModel):
    row: int
    col: int
    letter: Optional[str] = None
    owner: Optional[Player] = None
    locked: bool = False


class Scores(BaseModel):
    redTerritory: int = 0
    blueTerritory: int = 0
    redWord: int = 0
    blueWord: int = 0


class MoveHistoryItem(BaseModel):
    turn: int
    player: Player
    word: str
    moveType: str = "WORD"
    placedRow: Optional[int] = None
    placedCol: Optional[int] = None
    placedLetter: Optional[str] = None
    path: List[Coord] = []
    wordScoreGained: int = 0
    territoryGained: int = 0
    lockedCellsGained: int = 0
    captureCount: int = 0
    comboLabels: List[str] = []
    redTotalAfter: float = 0
    blueTotalAfter: float = 0


class GameState(BaseModel):
    boardSize: int
    board: List[List[Cell]]
    currentPlayer: Player
    turn: int
    usedWords: List[str]
    recentMoves: List[str]
    moveHistory: List[MoveHistoryItem] = []
    scores: Scores
    winner: Optional[Player] = None
    consecutivePasses: int = 0
    vsBot: bool = True
    botPlayer: Player = "BLUE"
    botLevel: BotLevel = "normal"
    openingName: str = ""
    lastChangedCells: List[Coord] = []
    lastCapturedCells: List[Coord] = []
    lastLockedCells: List[Coord] = []
    lastComboLabels: List[str] = []
    # ── Draft / Hand system (設計案2) ──────────────────────────────────────
    # sharedDraft: 3 letters revealed each turn — both players choose from these
    sharedDraft: List[str] = []
    redHand:  List[str] = []   # RED's current hand (chosen from draft)
    blueHand: List[str] = []   # BLUE's current hand


class CreateGameRequest(BaseModel):
    botLevel: BotLevel = "normal"


class CreateGameResponse(BaseModel):
    game_id: str
    state: GameState


class MoveRequest(BaseModel):
    game_id: str
    row: int
    col: int
    letter: str
    path: List[Coord]


class SeedMoveRequest(BaseModel):
    row: int
    col: int
    letter: str


class PreviewMoveRequest(BaseModel):
    row: int
    col: int
    letter: str
    path: List[Coord]


class PreviewMoveResponse(BaseModel):
    word: str = ""
    isValidLength: bool = False
    includesPlacedCell: bool = False
    isInDictionary: bool = False
    wordScore: int = 0
    territoryGain: int = 0
    lockGain: int = 0
    captureHappened: bool = False
    captureCount: int = 0
    comboLabels: List[str] = []
    errorMessage: Optional[str] = None


class SuggestionsResponse(BaseModel):
    suggestions: List[str]


class DailyInfo(BaseModel):
    dateStr: str
    dayNumber: int
    openingName: str


# ── Daily Leaderboard ────────────────────────────────────────────────────────

class DailyScoreSubmission(BaseModel):
    nickname: str
    redScore: float
    blueScore: float
    won: bool
    turns: int


class LeaderboardEntry(BaseModel):
    rank: int
    nickname: str
    score: float
    won: bool
    turns: int


class DailyLeaderboardResponse(BaseModel):
    dateStr: str
    dayNumber: int
    openingName: str
    totalPlayers: int
    entries: List[LeaderboardEntry]


class WaitlistSubmission(BaseModel):
    email: str
