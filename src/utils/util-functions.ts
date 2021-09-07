import { Map } from 'immutable';
import fetch, { RequestInfo } from 'node-fetch';

function partitionArray<T>(array: readonly T[], partitionSize: number): readonly T[][] {
	const workingCopy: T[] = [...array];
	const result: T[][] = [];
	while (workingCopy.length) {
		result.push(workingCopy.splice(0, partitionSize));
	}
	return result;
}

async function http(request: RequestInfo): Promise<any> {
	return new Promise(resolve => {
		fetch(request)
			.then(
				response => {
					return response.text();
				},
				error => {
					console.warn('could not retrieve review', error);
				},
			)
			.then(body => {
				resolve(body);
			});
	});
}

async function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function groupBy(list, keyGetter): Map<string, any[]> {
	let map = Map.of();
	list.forEach(item => {
		const key = keyGetter(item);
		const collection = map.get(key);
		if (!collection) {
			map = map.set(key, [item]);
		} else {
			collection.push(item);
		}
	});
	return map;
}

export const toCreationDate = (today: Date): string => {
	return `${today
		.toISOString()
		.slice(0, 19)
		.replace('T', ' ')}.${today.getMilliseconds()}`;
};

export const formatDate = (today: Date): string => {
	return `${today
		.toISOString()
		.slice(0, 19)
		.replace('T', ' ')}.000000`;
};

export { partitionArray, http, sleep, groupBy };
