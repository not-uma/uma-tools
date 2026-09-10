import type { CourseData } from '../uma-skill-tools/CourseData';
import type { RaceParameters } from '../uma-skill-tools/RaceParameters';
import { Rule30CARng } from '../uma-skill-tools/Random';

import { HorseState } from '../components/HorseDefTypes';
import { runComparison } from './compare';
import { runHpCalc } from './hpcalc';

import skillmeta from '../skill_meta.json';
import skilldata from '../uma-skill-tools/data/skill_data.json';

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
	const NROUNDS = 5;
	let results = run1Round(3, skills, course, racedef, uma, seedgen.pair(), options);
	postMessage({type: 'chart', results, progress: {done: 1, total: NROUNDS}});
	let update = run1Round(17, skills, course, racedef, uma, seedgen.pair(), options);
	mergeResultSets(results, update);
	postMessage({type: 'chart', results, progress: {done: 2, total: NROUNDS}});
	skills = skills.filter(id => results.get(id).max > 0.1);
	update = run1Round(30, skills, course, racedef, uma, seedgen.pair(), options);
	mergeResultSets(results, update);
	postMessage({type: 'chart', results, progress: {done: 3, total: NROUNDS}});
	skills = skills.filter(id => Math.abs(results.get(id).max - results.get(id).min) > 0.1);
	update = run1Round(50, skills, course, racedef, uma, seedgen.pair(), options);
	mergeResultSets(results, update);
	postMessage({type: 'chart', results, progress: {done: 4, total: NROUNDS}});
	update = run1Round(100, skills, course, racedef, uma, seedgen.pair(), options);
	mergeResultSets(results, update);
	postMessage({type: 'chart', results, progress: {done: NROUNDS, total: NROUNDS}, final: true});
}

// Recovery skills that fire on a fully deterministic condition -- no random roll,
// no field position, no lane. Anything else can't be relied on as "the last heal".
// null style = usable by anyone.
const HEAL_TRIGGERS = [
	{id: '201571', name: 'Triple 7s', strategy: null},
	{id: '200381', name: 'Breath of Fresh Air', strategy: null},
	{id: '201281', name: 'Restless', strategy: 'Nige'},
	{id: '201481', name: 'Go-Home Specialist', strategy: 'Oikomi'},
	// Order-gated, but the engine resolves order statically against the order range,
	// so these either always fire or never fire -- no per-run coin flip. Their exact
	// position varies inside the corner region, which is how the skill really behaves.
	{id: '900321', name: 'U=ma2 (inherited)', strategy: null},
	{id: '900621', name: 'Go, Go, Mun! (inherited)', strategy: null}
];

// A skill gated on activate_count_heal>=N only fires once the Nth recovery lands.
// Rather than pretending all N are free, assume N-1 happened (players do stack
// unreliable heals) and let one reliable skill supply the last one, at its real
// position. Try each candidate and keep whichever gives the best result.
function healRequirement(ids: string[]) {
	for (const id of ids) {
		const sk = skilldata[id];
		if (sk == null) continue;
		for (const alt of sk.alternatives) {
			const m = ((alt.precondition || '') + '&' + alt.condition).match(/activate_count_heal>=(\d+)/);
			if (m) return +m[1];
		}
	}
	return 0;
}

function gainWithHealTrigger(nsamples, course, e, base, ids, replaceGroup, seed, options, need) {
	const usable = HEAL_TRIGGERS.filter(c =>
		(c.strategy == null || c.strategy == e.strategy) && (c.id in skillmeta));
	if (usable.length == 0) return null;
	const healOpts = {...options, collectRunData: false, healSeed: Math.max(need - 1, 0), forceSkillConditions: false};

	function measure(cands, withWisdomChecks: boolean, n: number) {
		const b2 = {...base, skills: new Map(base.skills.entries())};
		cands.forEach(c => b2.skills.set(skillmeta[c.id].groupId, c.id));
		const withSkill = {...b2, skills: new Map(b2.skills.entries())};
		if (replaceGroup != null) withSkill.skills.delete(replaceGroup);
		ids.forEach(id => { const meta = skillmeta[id]; if (meta) withSkill.skills.set(meta.groupId, id); });
		const r = runComparison(n, course, e.racedef, b2, withSkill,
			seed, {...healOpts, useIntChecks: withWisdomChecks});
		const samples = r.results.length;
		return {
			value: r.results.reduce((a,b) => a+b, 0) / samples,
			fireRate: ids.length ? Math.min(...ids.map(id => (r.activations.get(id) || 0))) / samples : 0
		};
	}

	// 1. score each candidate on its own. A candidate that fires early is bad here:
	//    it satisfies the count before the unique's own distance gate, so the unique
	//    fires at the gate instead of somewhere useful.
	const solo = usable.map(c => ({c, ...measure([c], false, Math.max(nsamples >> 1, 5))}));
	solo.sort((a,b) => b.value - a.value);
	const best = solo[0];
	if (best == null || !isFinite(best.value)) return null;

	// 2. a candidate only works as a BACKUP if it fires about as late as the primary.
	//    An earlier one would pre-empt the trigger and drag the value down.
	const squad = solo.filter(x => x === best || x.value >= best.value * 0.95).map(x => x.c);

	// 3. re-run the squad with wit checks on, so each trigger independently rolls
	//    max(1 - 90/wisdom, 0.2). Two late triggers cover each other's failures.
	const final = measure(squad, true, nsamples);
	return {
		value: final.value,
		trigger: best.c.name,
		backups: squad.length - 1,
		fireRate: final.fireRate,
		fired: final.fireRate > 0
	};
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
			for (const id of ids) {
				const meta = skillmeta[id];
				// name the offending id rather than failing with a bare "reading 'groupId'"
				if (meta == null) throw new Error(`skill ${id} is missing from skill_meta.json`);
				withSkill.skills.set(meta.groupId, id);
			}
			const {results, activations} = runComparison(nsamples, course, e.racedef, base, withSkill, seed,
				{...options, collectRunData: false});
			const never = ids.filter(id => !(activations.get(id) > 0));
			return {value: results.reduce((a,b) => a+b, 0) / results.length, never};
		}
		const healNeed = options.forceSkillConditions ? healRequirement(e.uniqueSkills) : 0;
		let u, healTrigger = null, healBackups = 0, healFireRate = 0;
		if (healNeed > 0) {
			const best = gainWithHealTrigger(nsamples, course, e, base, e.uniqueSkills, e.replaceGroup, seed, options, healNeed);
			if (best != null) {
				u = {value: best.value, never: best.fired ? [] : e.uniqueSkills};
				healTrigger = best.trigger;
				healBackups = best.backups;
				healFireRate = best.fireRate;
			}
			else u = {value: 0, never: e.uniqueSkills};   // no reliable trigger for this style
		} else {
			u = gain(e.uniqueSkills, e.replaceGroup);
		}
		const a = gain(e.awakenSkills);
		data.set(e.key, {
			key: e.key,
			uniqueValue: u.value,
			awakenValue: a.value,
			// skills whose conditions were never met in any sample -- shown in the UI so a
			// 0.00 reads as "never fired" rather than "fired but did nothing"
			uniqueNeverFired: e.uniqueSkills.length > 0 && u.never.length > 0,
			healTrigger,
			healBackups,
			healFireRate,
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
	const ROUNDS = [30, 100];
	// report this worker's share so the bar total always matches what is actually
	// run, however many workers the pool has and however many rounds we use
	postMessage({type: 'umarankstart', total: entries.length * ROUNDS.length});
	ROUNDS.forEach(n => runUmaRound(n, entries, course, uma, seedgen.pair(), options));
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
	// count the warm-up rounds first so the progress bar has a real total
	let nrounds = 1;
	for (let n = Math.min(20, nsamples), mul = 6; n < nsamples; n = Math.min(n * mul, nsamples), mul = Math.max(mul - 1, 2)) ++nrounds;
	let round = 0;
	for (let n = Math.min(20, nsamples), mul = 6; n < nsamples; n = Math.min(n * mul, nsamples), mul = Math.max(mul - 1, 2)) {
		results = runComparison(n, course, racedef, uma1, uma2, seedgen.pair(), options);
		postMessage({type: 'compare', results, progress: {done: ++round, total: nrounds}});
	}
	results = runComparison(nsamples, course, racedef, uma1, uma2, seedgen.pair(), options);
	postMessage({type: 'compare', results, progress: {done: nrounds, total: nrounds}, final: true});
}

function doHpCalc({nsamples, course, racedef, uma, debufUma, options}) {
	const seedgen = new Rule30CARng(options.seed);
	let results;
	// count the warm-up rounds first so the progress bar has a real total
	let nrounds = 1;
	for (let n = Math.min(20, nsamples), mul = 6; n < nsamples; n = Math.min(n * mul, nsamples), mul = Math.max(mul - 1, 2)) ++nrounds;
	let round = 0;
	for (let n = Math.min(20, nsamples), mul = 6; n < nsamples; n = Math.min(n * mul, nsamples), mul = Math.max(mul - 1, 2)) {
		results = runHpCalc(n, course, racedef, uma, debufUma, seedgen.pair(), options);
		postMessage({type: 'hpcalc', results, progress: {done: ++round, total: nrounds}});
	}
	results = runHpCalc(nsamples, course, racedef, uma, debufUma, seedgen.pair(), options);
	postMessage({type: 'hpcalc', results, progress: {done: nrounds, total: nrounds}, final: true});
}

self.addEventListener('message', function (e) {
	const {msg, data} = e.data;
	// Without this, a throw in here dies silently in the worker and the UI sits on
	// "working..." forever with no clue why. Report it back instead.
	try {
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
	} catch (err) {
		postMessage({type: 'error', task: msg, message: (err && err.message) || String(err)});
		throw err;   // still surface it in the console for debugging
	}
});
