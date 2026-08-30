import type { CourseData } from '../uma-skill-tools/CourseData';
import type { RaceParameters } from '../uma-skill-tools/RaceParameters';
import { Rule30CARng } from '../uma-skill-tools/Random';

import { HorseState } from '../components/HorseDefTypes';
import { runComparison } from './compare';
import { runHpCalc } from './hpcalc';

import skillmeta from '../skill_meta.json';

function mergeResults(results1, results2) {
	console.assert(results1.id == results2.id, `mergeResults: ${results1.id} != ${results2.id}`);
	const n1 = results1.results.length, n2 = results2.results.length;
	const combinedResults = results1.results.concat(results2.results).sort((a,b) => a - b);
	const combinedMean = (results1.mean * n1 + results2.mean * n2) / (n1 + n2);
	const mid = Math.floor(combinedResults.length / 2);
	const newMedian = combinedResults.length % 2 == 0 ? (combinedResults[mid-1] + combinedResults[mid]) / 2 : combinedResults[mid];
	return {
		id: results1.id,
		results: combinedResults,
		min: Math.min(results1.min, results2.min),
		max: Math.max(results1.max, results2.max),
		mean: combinedMean,
		median: newMedian,
		runData: {
			// TODO should re-compute the bashin gain from .t/.p and pick whichever is closer to new mean/median
			...(n2 > n1 ? results2.runData : results1.runData),
			minrun: results1.min < results2.min ? results1.runData.minrun : results2.runData.minrun,
			maxrun: results1.max > results2.max ? results1.runData.maxrun : results2.runData.maxrun,
		}
	};
}

function mergeResultSets(data1, data2) {
	data2.forEach((r,id) => {
		data1.set(id, mergeResults(data1.get(id), r));
	});
}

function run1Round(nsamples: number, skills: string[], course: CourseData, racedef: RaceParameters, uma: HorseState, seed: [number,number], options) {
	const data = new Map();
	skills.forEach(id => {
		const withSkill = {...uma, skills: new Map(uma.skills.entries())};
		withSkill.skills.set(skillmeta[id].groupId, id);
		const {results, runData} = runComparison(nsamples, course, racedef, uma, withSkill, seed, options);
		const mid = Math.floor(results.length / 2);
		const median = results.length % 2 == 0 ? (results[mid-1] + results[mid]) / 2 : results[mid];
		const mean = results.reduce((a,b) => a+b, 0) / results.length;
		data.set(id, {
			id, results, runData,
			min: results[0],
			max: results[results.length-1],
			mean,
			median
		});
	});
	return data;
}

function doChart({skills, course, racedef, uma, options}) {
	const seedgen = new Rule30CARng(options.seed);
	let results = run1Round(3, skills, course, racedef, uma, seedgen.pair(), options);
	postMessage({type: 'chart', results});
	let update = run1Round(17, skills, course, racedef, uma, seedgen.pair(), options);
	mergeResultSets(results, update);
	postMessage({type: 'chart', results});
	skills = skills.filter(id => results.get(id).max > 0.1);
	update = run1Round(30, skills, course, racedef, uma, seedgen.pair(), options);
	mergeResultSets(results, update);
	postMessage({type: 'chart', results});
	skills = skills.filter(id => Math.abs(results.get(id).max - results.get(id).min) > 0.1);
	update = run1Round(50, skills, course, racedef, uma, seedgen.pair(), options);
	mergeResultSets(results, update);
	postMessage({type: 'chart', results});
	update = run1Round(100, skills, course, racedef, uma, seedgen.pair(), options);
	mergeResultSets(results, update);
	postMessage({type: 'chart', results});
}

function runUmaRound(nsamples: number, entries, course: CourseData, uma: HorseState, seed: [number,number], options) {
	// Results are posted in small chunks so the UI can show progress and fill in
	// the table as it goes rather than freezing until the whole round finishes.
	let data = new Map();
	entries.forEach((e, i) => {
		// Fixed baseline: the user's own stats, no skills. Only the running style
		// varies, since unique skills are frequently gated on it. Aptitudes are
		// deliberately NOT taken from the uma -- they are reported separately.
		const base = options.includeUmaSkills
			? {...uma, strategy: e.strategy}
			: {...uma, strategy: e.strategy, skills: new Map(), samplePolicies: new Map()};
		// replaceGroup: a skill group to strip off the compared build. Used when the
		// baseline already carries this uma's INHERITED unique -- an uma cannot hold
		// both, so the measured value is the swap, not an addition on top.
		function gain(ids: string[], replaceGroup?: string) {
			if (ids.length == 0) return {value: 0, never: []};
			const withSkill = {...base, skills: new Map(base.skills.entries())};
			if (replaceGroup != null) withSkill.skills.delete(replaceGroup);
			ids.forEach(id => withSkill.skills.set(skillmeta[id].groupId, id));
			const {results, activations} = runComparison(nsamples, course, e.racedef, base, withSkill, seed,
				{...options, collectRunData: false});
			const never = ids.filter(id => !(activations.get(id) > 0));
			return {value: results.reduce((a,b) => a+b, 0) / results.length, never};
		}
		const u = gain(e.uniqueSkills, e.replaceGroup);
		const a = gain(e.awakenSkills);
		data.set(e.key, {
			key: e.key,
			uniqueValue: u.value,
			awakenValue: a.value,
			// skills whose conditions were never met in any sample -- shown in the UI so a
			// 0.00 reads as "never fired" rather than "fired but did nothing"
			uniqueNeverFired: e.uniqueSkills.length > 0 && u.never.length > 0,
			awakenNeverFired: a.never.length,
			awakenSimulated: e.awakenSkills.length,
			pending: false
		});
		if (data.size >= 6 || i == entries.length - 1) {
			postMessage({type: 'umarank', results: data, done: data.size});
			data = new Map();
		}
	});
}

function doUmaRank({entries, course, uma, options}) {
	const seedgen = new Rule30CARng(options.seed);
	// The 5-sample round is skipped -- its results are overwritten within a second
	// and it cost ~4% of the run. Its seed pair still has to be consumed, though,
	// or every later round shifts onto a different pair and the same seed stops
	// reproducing the same numbers.
	seedgen.pair();
	[30, 100].forEach(n => runUmaRound(n, entries, course, uma, seedgen.pair(), options));
	postMessage({type: 'umarankdone'});
}

function doUmaDetail({key, strategy, skills, course, racedef, uma, options}) {
	const seedgen = new Rule30CARng(options.seed);
	seedgen.pair();   // consume the dropped 5-sample round's pair, see doUmaRank
	// must honour includeUmaSkills exactly like runUmaRound does, otherwise every
	// expanded row is simulated against an empty baseline and skills gated on
	// other skills activating can never fire.
	const base = options.includeUmaSkills
		? {...uma, strategy}
		: {...uma, strategy, skills: new Map(), samplePolicies: new Map()};
	[30, 100].forEach(n => {
		const seed = seedgen.pair();
		const results = new Map();
		skills.forEach(id => {
			const withSkill = {...base, skills: new Map(base.skills.entries())};
			withSkill.skills.set(skillmeta[id].groupId, id);
			const r = runComparison(n, course, racedef, base, withSkill, seed, {...options, collectRunData: false});
			results.set(id, {
				value: r.results.reduce((a,b) => a+b, 0) / r.results.length,
				fired: r.activations.get(id) || 0,
				samples: r.results.length
			});
		});
		postMessage({type: 'umadetail', key, results});
	});
}

function doCompare({nsamples, course, racedef, uma1, uma2, options}) {
	const seedgen = new Rule30CARng(options.seed);
	let results;
	for (let n = Math.min(20, nsamples), mul = 6; n < nsamples; n = Math.min(n * mul, nsamples), mul = Math.max(mul - 1, 2)) {
		results = runComparison(n, course, racedef, uma1, uma2, seedgen.pair(), options);
		postMessage({type: 'compare', results});
	}
	results = runComparison(nsamples, course, racedef, uma1, uma2, seedgen.pair(), options);
	postMessage({type: 'compare', results});
}

function doHpCalc({nsamples, course, racedef, uma, debufUma, options}) {
	const seedgen = new Rule30CARng(options.seed);
	let results;
	for (let n = Math.min(20, nsamples), mul = 6; n < nsamples; n = Math.min(n * mul, nsamples), mul = Math.max(mul - 1, 2)) {
		results = runHpCalc(n, course, racedef, uma, debufUma, seedgen.pair(), options);
		postMessage({type: 'hpcalc', results});
	}
	results = runHpCalc(nsamples, course, racedef, uma, debufUma, seedgen.pair(), options);
	postMessage({type: 'hpcalc', results});
}

self.addEventListener('message', function (e) {
	const {msg, data} = e.data;
	switch (msg) {
		case 'chart':
			doChart(data);
			break;
		case 'umarank':
			doUmaRank(data);
			break;
		case 'umadetail':
			doUmaDetail(data);
			break;
		case 'compare':
			doCompare(data);
			break;
		case 'hpcalc':
			doHpCalc(data);
			break;
	}
});
