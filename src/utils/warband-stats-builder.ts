import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { CardType, GameTag, Step, Zone } from '@firestone-hs/reference-data';
import { Element } from 'elementtree';
import { Map } from 'immutable';

export const buildCompsByTurn = (
	replay: Replay,
): Map<number, readonly { cardId: string; attack: number; health: number }[]> => {
	const elementTree = replay.replay;
	const opponentPlayerElement = elementTree
		.findall('.//Player')
		.find(player => player.get('isMainPlayer') === 'false');
	const opponentPlayerEntityId = opponentPlayerElement.get('id');
	const structure = {
		entities: {},
		boardByTurn: Map.of(),
		currentTurn: 0,
	};
	parseElement(elementTree.getroot(), replay.mainPlayerId, opponentPlayerEntityId, null, structure);
	return structure.boardByTurn;
};

const parseElement = (
	element: Element,
	mainPlayerId: number,
	opponentPlayerEntityId: string,
	parent: Element,
	structure,
) => {
	if (element.tag === 'FullEntity') {
		structure.entities[element.get('id')] = {
			cardId: element.get('cardID'),
			controller: parseInt(element.find(`.Tag[@tag='${GameTag.CONTROLLER}']`)?.get('value') || '-1'),
			zone: parseInt(element.find(`.Tag[@tag='${GameTag.ZONE}']`)?.get('value') || '-1'),
			zonePosition: parseInt(element.find(`.Tag[@tag='${GameTag.ZONE_POSITION}']`)?.get('value') || '-1'),
			cardType: parseInt(element.find(`.Tag[@tag='${GameTag.CARDTYPE}']`)?.get('value') || '-1'),
			attack: parseInt(element.find(`.Tag[@tag='${GameTag.ATK}']`)?.get('value') || '-1'),
			health: parseInt(element.find(`.Tag[@tag='${GameTag.HEALTH}']`)?.get('value') || '-1'),
		};
	}
	// Deathwing
	if (element.tag === 'ShowEntity' && element.get('cardID') === 'TB_BaconShop_HP_061e') {
		const attachedTo = parseInt(element.find(`.Tag[@tag='${GameTag.ATTACHED}']`)?.get('value') || '-1');
		if (structure.entities[attachedTo]) {
			// We don't need to remove this flag, as new entities are created for each round?
			structure.entities[attachedTo].isDeathwing = true;
		}
	}
	if (element.tag === 'TagChange') {
		if (structure.entities[element.get('entity')]) {
			if (parseInt(element.get('tag')) === GameTag.CONTROLLER) {
				structure.entities[element.get('entity')].controller = parseInt(element.get('value'));
			}
			if (parseInt(element.get('tag')) === GameTag.ZONE) {
				structure.entities[element.get('entity')].zone = parseInt(element.get('value'));
			}
			if (parseInt(element.get('tag')) === GameTag.ATK) {
				structure.entities[element.get('entity')].attack = parseInt(element.get('value'));
				if (structure.entities[element.get('entity')].isDeathwing) {
					structure.entities[element.get('entity')].attack -= 3;
				}
			}
			if (parseInt(element.get('tag')) === GameTag.HEALTH) {
				structure.entities[element.get('entity')].health = parseInt(element.get('value'));
			}
			if (parseInt(element.get('tag')) === GameTag.ZONE_POSITION) {
				structure.entities[element.get('entity')].zonePosition = parseInt(element.get('value'));
			}
		}
		if (
			parseInt(element.get('tag')) === GameTag.NEXT_STEP &&
			parseInt(element.get('value')) === Step.MAIN_START_TRIGGERS
		) {
			if (parent && parent.get('entity') === opponentPlayerEntityId) {
				const playerEntitiesOnBoard = Object.values(structure.entities)
					.map(entity => entity as any)
					.filter(entity => entity.controller === mainPlayerId)
					.filter(entity => entity.zone === Zone.PLAY)
					.filter(entity => entity.cardType === CardType.MINION)
					.sort((a, b) => a.zonePosition - b.zonePosition)
					.map(entity => ({
						cardId: entity.cardId,
						attack: entity.attack,
						health: entity.health,
					}));
				structure.boardByTurn = structure.boardByTurn.set(structure.currentTurn, playerEntitiesOnBoard);
				structure.currentTurn++;
			}
		}
	}

	const children = element.getchildren();
	if (children && children.length > 0) {
		for (const child of children) {
			parseElement(child, mainPlayerId, opponentPlayerEntityId, element, structure);
		}
	}
};
