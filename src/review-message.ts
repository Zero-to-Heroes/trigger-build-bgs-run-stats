import { Race } from '@firestone-hs/reference-data';

export interface ReviewMessage {
	readonly replayKey: string;
	readonly coinPlay: 'play' | 'coin';
	readonly opponentClass: string;
	readonly opponentDecklist: string;
	readonly opponentHero: string;
	readonly opponentName: string;
	readonly opponentRank: string;
	readonly playerClass: string;
	readonly playerDecklist: string;
	readonly playerHero: string;
	readonly playerName: string;
	readonly playerRank: string;
	readonly result: 'lost' | 'won' | 'tied';
	readonly reviewId: string;
	readonly gameMode: string;
	readonly creationDate: string;
	readonly userId: string;
	readonly gameFormat: string;
	readonly opponentCardId: string;
	readonly playerCardId: string;
	readonly uploaderToken: string;
	readonly buildNumber: number;
	readonly playerDeckName: string;
	readonly scenarioId: string;
	readonly additionalResult: string;
	readonly availableTribes: readonly Race[];
	readonly bannedTribes: readonly Race[];
	readonly currentDuelsRunId: string;
	readonly runId: string;
	readonly appVersion: string;
}
