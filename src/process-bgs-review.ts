import { BgsPostMatchStats, parseBattlegroundsGame } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { AllCardsService } from '@firestone-hs/reference-data';
import { inflate } from 'pako';
import { ServerlessMysql } from 'serverless-mysql';
import SqlString from 'sqlstring';
import { ReviewMessage } from './review-message';
import { logger, S3, getConnection, logBeforeTimeout } from '@firestone-hs/aws-lambda-utils';

const allCards = new AllCardsService();
const s3 = new S3();

// This example demonstrates a NodeJS 8.10 async handler[1], however of course you could use
// the more traditional callback-style handler.
// [1]: https://aws.amazon.com/blogs/compute/node-js-8-10-runtime-now-available-in-aws-lambda/
export default async (event, context): Promise<any> => {
	const cleanup = logBeforeTimeout(context);
	const messages: readonly ReviewMessage[] = (event.Records as any[])
		.map(event => JSON.parse(event.body))
		.reduce((a, b) => a.concat(b), [])
		.filter(event => event)
		.map(event => event.Message)
		.filter(msg => msg)
		.map(msg => JSON.parse(msg));
	const mysql = await getConnection();
	for (const message of messages) {
		logger.debug('handling review', message.reviewId);
		await handleReview(message, mysql);
	}
	await mysql.end();
	cleanup();
	return { statusCode: 200, body: null };
};

const handleReview = async (message: ReviewMessage, mysql: ServerlessMysql): Promise<void> => {
	const useNewProcess = true;
	if (useNewProcess) {
		console.log('new process, returning');
		return;
	}

	if (message.gameMode !== 'battlegrounds') {
		logger.debug('not battlegrounds', message);
		return;
	}
	if (!message.additionalResult || isNaN(parseInt(message.additionalResult))) {
		logger.debug('no end position', message);
		return;
	}
	// if (!message.playerRank || isNaN(parseInt(message.playerRank))) {
	// 	logger.debug('no player rank', message);
	// 	return;
	// }
	// if (!message.availableTribes?.length) {
	// 	logger.debug('no available tribes', message);
	// 	return;
	// }
	await allCards.initializeCardsDb();

	// Handling skins
	const heroCardId = normalizeHeroCardId(message.playerCardId, allCards);

	const warbandStats = await buildWarbandStats(message);
	// Because there is a race, the combat winrate might have been populated first
	const combatWinrate = await retrieveCombatWinrate(message, mysql);
	logger.debug('retrieved combat winrate?', combatWinrate);
	const playerRank = message.playerRank ?? message.newPlayerRank;
	const row: InternalBgsRow = {
		creationDate: new Date(message.creationDate),
		buildNumber: message.buildNumber,
		reviewId: message.reviewId,
		rank: parseInt(message.additionalResult),
		heroCardId: heroCardId,
		rating: playerRank == null ? null : parseInt(playerRank),
		tribes: message.availableTribes
			?.map(tribe => tribe.toString())
			.sort()
			.join(','),
		darkmoonPrizes: false,
		warbandStats: warbandStats,
		combatWinrate: combatWinrate,
	} as InternalBgsRow;

	const insertQuery = `
		INSERT IGNORE INTO bgs_run_stats 
		(
			creationDate,
			buildNumber,
			rank,
			heroCardId,
			rating,
			reviewId,
			darkmoonPrizes,
			tribes,
			combatWinrate,
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
			${SqlString.escape(JSON.stringify(row.combatWinrate))},
			${SqlString.escape(JSON.stringify(row.warbandStats))}
		)
	`;
	logger.debug('running query', insertQuery);
	await mysql.query(insertQuery);
};

const buildWarbandStats = async (message: ReviewMessage): Promise<readonly InternalWarbandStats[]> => {
	try {
		const replayString = await s3.loadReplayString(message.replayKey);
		const stats = parseBattlegroundsGame(replayString, null, null, null);
		const result = stats.totalStatsOverTurn.map(stat => ({
			turn: stat.turn,
			totalStats: stat.value,
		}));
		logger.debug('built warband stats', message.reviewId, result);
		return result;
		// const compsByTurn: Map<
		// 	number,
		// 	readonly { cardId: string; attack: number; health: number }[]
		// > = buildCompsByTurn(replay);
		// const warbandStats: readonly InternalWarbandStats[] = compsByTurn
		// 	.map((value, key) => value.reduce((acc, obj) => acc + (obj.attack || 0) + (obj.health || 0), 0))
		// 	.map(
		// 		(totalStatsForTurn, turnNumber) =>
		// 			({
		// 				turn: turnNumber,
		// 				totalStats: totalStatsForTurn,
		// 			} as InternalWarbandStats),
		// 	)
		// 	.valueSeq()
		// 	.toArray();
		// return warbandStats;
	} catch (e) {
		logger.error('Exception while building warband stats', e);
		return null;
	}
};

const retrieveCombatWinrate = async (
	message: ReviewMessage,
	mysql: ServerlessMysql,
): Promise<readonly InternalCombatWinrate[]> => {
	const query = `
		SELECT * FROM bgs_single_run_stats
		WHERE reviewId = '${message.reviewId}'
	`;
	logger.debug('running query', query);
	const results: any[] = await mysql.query(query);
	logger.debug('results', results);
	if (!results?.length) {
		return null;
	}
	const stats = parseStats(results[0].jsonStats);
	return stats.battleResultHistory
		.filter(result => result?.simulationResult?.wonPercent != null)
		.map(result => ({
			turn: result.turn,
			winrate: Math.round(10 * result.simulationResult.wonPercent) / 10,
		}));
};

const parseStats = (inputStats: string): BgsPostMatchStats => {
	try {
		const parsed = JSON.parse(inputStats);
		return parsed;
	} catch (e) {
		try {
			const fromBase64 = Buffer.from(inputStats, 'base64').toString();
			const inflated = inflate(fromBase64, { to: 'string' });
			return JSON.parse(inflated);
		} catch (e) {
			logger.warn('Could not build full stats, ignoring review', inputStats);
		}
	}
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
	// logger.debug('normalizing', heroCardId, bgHeroSkinMatch);
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
	readonly combatWinrate: readonly InternalCombatWinrate[];
	readonly warbandStats: readonly InternalWarbandStats[];
}

interface InternalCombatWinrate {
	readonly turn: number;
	readonly winrate: number;
}

interface InternalWarbandStats {
	readonly turn: number;
	readonly totalStats: number;
}
