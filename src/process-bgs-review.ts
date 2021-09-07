import { AllCardsService } from '@firestone-hs/reference-data';
import { ServerlessMysql } from 'serverless-mysql';
import SqlString from 'sqlstring';
import { getConnection } from './db/rds';
import { ReviewMessage } from './review-message';
import { parseHsReplayString, Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { buildCompsByTurn } from './utils/warband-stats-builder';
import { Map } from 'immutable';
import { S3 } from './db/s3';

const allCards = new AllCardsService();
const s3 = new S3();

// This example demonstrates a NodeJS 8.10 async handler[1], however of course you could use
// the more traditional callback-style handler.
// [1]: https://aws.amazon.com/blogs/compute/node-js-8-10-runtime-now-available-in-aws-lambda/
export default async (event): Promise<any> => {
	const messages: readonly ReviewMessage[] = (event.Records as any[])
		.map(event => JSON.parse(event.body))
		.reduce((a, b) => a.concat(b), [])
		.filter(event => event)
		.map(event => event.Message)
		.filter(msg => msg)
		.map(msg => JSON.parse(msg));
	const mysql = await getConnection();
	for (const message of messages) {
		await handleReview(message, mysql);
	}
	await mysql.end();
	return { statusCode: 200, body: null };
};

const handleReview = async (message: ReviewMessage, mysql: ServerlessMysql): Promise<void> => {
	if (message.gameMode !== 'battlegrounds') {
		console.log('not battlegrounds', message);
		return;
	}
	if (!message.additionalResult || isNaN(parseInt(message.additionalResult))) {
		console.log('no end position', message);
		return;
	}
	if (!message.playerRank || isNaN(parseInt(message.playerRank))) {
		console.log('no player rank', message);
		return;
	}
	if (!message.availableTribes?.length) {
		console.log('no available tribes', message);
		return;
	}
	await allCards.initializeCardsDb();

	// Handling skins
	const heroCardId = normalizeHeroCardId(message.playerCardId, allCards);

	const replayString = await s3.loadReplayString(message.replayKey);
	const replay: Replay = parseHsReplayString(replayString);
	const compsByTurn: Map<number, readonly { cardId: string; attack: number; health: number }[]> = buildCompsByTurn(
		replay,
	);
	const warbandStats: readonly InternalWarbandStats[] = compsByTurn
		.map((value, key) => value.reduce((acc, obj) => acc + (obj.attack || 0) + (obj.health || 0), 0))
		.map(
			(totalStatsForTurn, turnNumber) =>
				({
					turn: turnNumber,
					totalStats: totalStatsForTurn,
				} as InternalWarbandStats),
		)
		.valueSeq()
		.toArray();

	const row: InternalBgsRow = {
		creationDate: new Date(message.creationDate),
		buildNumber: message.buildNumber,
		reviewId: message.reviewId,
		rank: parseInt(message.additionalResult),
		heroCardId: heroCardId,
		rating: parseInt(message.playerRank),
		tribes: message.availableTribes.map(tribe => tribe.toString()).join(','),
		darkmoonPrizes: false,
		warbandStats: warbandStats,
		// combatWinrate is set in the post-match stats function
	} as InternalBgsRow;

	const insertQuery = `
		INSERT INTO bgs_run_stats 
		(
			creationDate,
			buildNumber,
			rank,
			heroCardId,
			rating,
			reviewId,
			darkmoonPrizes,
			tribes,
			warbandStats
		)
		VALUES 
		(
			${SqlString.escape(row.creationDate)},
			${SqlString.escape(row.buildNumber)}, 
			${SqlString.escape(row.rank)}, 
			${SqlString.escape(row.heroCardId)},
			${SqlString.escape(row.rating)},
			${SqlString.escape(row.reviewId)},
			${SqlString.escape(row.darkmoonPrizes)},
			${SqlString.escape(row.tribes)},
			${SqlString.escape(JSON.stringify(row.warbandStats))}
		)
	`;
	console.log('running query', insertQuery);
	await mysql.query(insertQuery);
};

const normalizeHeroCardId = (heroCardId: string, allCards: AllCardsService = null): string => {
	if (!heroCardId) {
		return heroCardId;
	}

	// Generic handling of BG hero skins, hoping they will keep the same pattern
	if (allCards) {
		const heroCard = allCards.getCard(heroCardId);
		if (!!heroCard?.battlegroundsHeroParentDbfId) {
			const parentCard = allCards.getCardFromDbfId(heroCard.battlegroundsHeroParentDbfId);
			if (!!parentCard) {
				return parentCard.id;
			}
		}
	}

	// Fallback to regex
	const bgHeroSkinMatch = heroCardId.match(/(.*)_SKIN_.*/);
	// console.debug('normalizing', heroCardId, bgHeroSkinMatch);
	if (bgHeroSkinMatch) {
		return bgHeroSkinMatch[1];
	}

	switch (heroCardId) {
		case 'TB_BaconShop_HERO_59t':
			return 'TB_BaconShop_HERO_59';
		default:
			return heroCardId;
	}
};

interface InternalBgsRow {
	readonly creationDate: Date;
	readonly buildNumber: number;
	readonly rating: number;
	readonly heroCardId: string;
	readonly rank: number;
	readonly reviewId: string;
	readonly tribes: string;
	readonly darkmoonPrizes: boolean;
	readonly combatWinrate: string;
	readonly warbandStats: readonly InternalWarbandStats[];
}

interface InternalCombatWinrate {
	readonly turn: number;
	readonly totalWinrate: number;
}

interface InternalWarbandStats {
	readonly turn: number;
	readonly totalStats: number;
}
