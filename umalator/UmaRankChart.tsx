import { h, Fragment } from 'preact';
import { useState, useMemo, useRef, useEffect, useId } from 'preact/hooks';
import { memo } from 'preact/compat';
import { Text } from 'preact-i18n';

import {
	SortingState, createSortedRowModel, flexRender, rowSortingFeature, sortFns, tableFeatures, useTable
} from '@tanstack/preact-table';

import { CourseData } from '../uma-skill-tools/CourseData';
import { uniqueSkillForUma } from '../components/HorseDefTypes';

import './UmaRankChart.css';

import icons from '../icons.json';
import skilldata from '../uma-skill-tools/data/skill_data.json';
import skillmeta from '../skill_meta.json';
import skillnames from '../uma-skill-tools/data/skillnames.json';
import umas from '../umas.json';

// Bump this whenever UmaRankChart/app.tsx change, so you can confirm in the
// browser which build is actually live:
//   document.querySelector('[data-umarank-build]').dataset.umarankBuild
export const UMARANK_BUILD = 'umarank-9-threestar-unique';

const APT = ' GFEDCBA';
// Internal strategy identifiers the simulator expects, and the English names
// the game uses for them (matching strings/common.ts).
export const STRATEGIES = ['', 'Nige', 'Senkou', 'Sasi', 'Oikomi'];
export const STRATEGY_LABELS = {
	Nige: 'Front Runner', Senkou: 'Pace Chaser',
	Sasi: 'Late Surger', Oikomi: 'End Closer', Oonige: 'Runaway'
};
// Every uma is tried under every running style, so the table answers
// "which style should this uma run here", not just "how is her default style".
export const ALL_STRATEGIES = ['Nige', 'Senkou', 'Sasi', 'Oikomi'];

// Keep only the strongest skill of each line: awakening trees ship both the
// white and the gold version of the same group. Evolution skills (rarity 6)
// are never included.
// Awakening trees only ever list the base (circle) form of an aptitude skill --
// no double-circle skill appears in any awakening list. The double-circle is what
// you end up with once the tree is fully upgraded, so that is what we simulate.
const upgradeToDoubleCircle = (function () {
	const byGroup = new Map<string, string[]>();
	Object.keys(skilldata).forEach(id => {
		if (!(id in skillmeta)) return;
		const g = skillmeta[id].groupId;
		if (!byGroup.has(g)) byGroup.set(g, []);
		byGroup.get(g).push(id);
	});
	const up = new Map<string, string>();
	Object.keys(skilldata).forEach(id => {
		const nm = skillnames[id] && skillnames[id][skillnames[id].length - 1];
		if (!nm || !nm.endsWith('\u25cb')) return;   // only upgrade circle skills
		const base = nm.slice(0, -1);
		const better = (byGroup.get(skillmeta[id].groupId) || []).find(sib => {
			const sn = skillnames[sib] && skillnames[sib][skillnames[sib].length - 1];
			return sn === base + '\u25ce' && skilldata[sib].rarity === skilldata[id].rarity;
		});
		if (better) up.set(id, better);
	});
	return up;
})();

export function dedupeAwakenings(list: string[]) {
	const byGroup = new Map<string, string>();
	list.forEach(id => {
		if (!(id in skilldata) || skilldata[id].rarity == 6) return;  // never evolution skills
		if (!(id in skillmeta)) return;
		const g = skillmeta[id].groupId;
		const cur = byGroup.get(g);
		if (cur == null || skilldata[id].rarity > skilldata[cur].rarity) byGroup.set(g, id);
	});
	// keep only the strongest of each line, then take the fully-upgraded form
	return Array.from(byGroup.values()).map(id => upgradeToDoubleCircle.get(id) || id);
}

// One row per outfit, since awakening trees differ between outfits of the same uma.
export function getUmaEntries() {
	const out = [];
	Object.keys(umas).forEach(uid => {
		const uma = umas[uid];
		Object.keys(uma.outfits).forEach(oid => {
			const o = uma.outfits[oid];
			// Always use the 3-star+ unique. 17 outfits have a base star of 2, whose
			// unique is a WEAKER, differently-named skill (Mejiro Ryan's "Feel the
			// Burn!" vs "Let's Pump Some Iron!"). Those 2-star forms have no
			// inherited version in the data, so the swap could never match, and
			// nobody races them at 2 stars anyway.
			const unique = uniqueSkillForUma(oid, Math.max(o.rarity, 3) as 3 | 4 | 5);
			if (!unique || !(unique in skilldata)) return;
			const awakenings = dedupeAwakenings(o.awakenings);
			const aptitudes = o.aptitudes.map(i => APT[i]);
			const defaultStrategy = STRATEGIES[o.strategy];
			ALL_STRATEGIES.forEach(strategy => {
				out.push({
					key: `${oid}:${strategy}`,
					outfitId: oid,
					umaId: uid,
					name: uma.name[uma.name.length - 1],
					epithet: o.epithet,
					strategy,
					isDefaultStrategy: strategy == defaultStrategy,
					starCount: o.rarity,
					aptitudes,
					unique,
					inheritedGroup: inheritedGroupOf(unique),
					awakenings
				});
			});
		});
	});
	return out;
}

// An inherited unique has the same id with a leading 9 substituted, but it sits
// in a DIFFERENT skill group, so adding the base unique would not displace it.
// An uma cannot carry both, so the inherited one has to be removed explicitly.
// Ranks variants within one skill group so we never hand an uma a WORSE version
// of something she already has. Gold (rarity 2) outranks white; within the same
// rarity, double-circle beats circle beats cross.
export function skillRank(id: string) {
	if (!(id in skilldata)) return -1;
	const v = skillnames[id] && skillnames[id][skillnames[id].length - 1];
	const variant = !v ? 1
		: v.endsWith('\u25ce') ? 2
		: v.endsWith('\u25cb') ? 1
		: v.endsWith('\u00d7') ? 0
		: 1;
	return skilldata[id].rarity * 10 + variant;
}

// True when the baseline already carries this skill's line at an equal or better
// grade, so adding it would change nothing (or actively downgrade the build).
export function alreadyCovered(id: string, equipped: Map<string,string>) {
	if (!(id in skillmeta)) return false;
	const have = equipped.get(skillmeta[id].groupId);
	return have != null && skillRank(have) >= skillRank(id);
}

// The uma picked in the left panel carries its own base unique in `skills`.
// Leaving it on the baseline would zero out that uma's own row AND hand every
// other row a baseline that already has a unique on it, so it comes off.
// Inherited uniques (id starting with 9) are left alone -- those are handled
// by the swap logic instead.
export function isBaseUnique(id: string) {
	// rarity 3 is the 2-star form of a unique, 4 and 5 are the 3-star+ forms.
	// All non-inherited skills at rarity >= 3 are uniques, nothing else.
	return id[0] != '9' && id in skilldata && skilldata[id].rarity >= 3;
}

export function stripOwnUnique(uma) {
	const skills = new Map();
	uma.skills.forEach((id, group) => { if (!isBaseUnique(id)) skills.set(group, id); });
	return {...uma, skills};
}

export function inheritedFormOf(uniqueId: string) {
	const inh = '9' + uniqueId.slice(1);
	return inh in skilldata ? inh : null;
}

export function inheritedGroupOf(uniqueId: string) {
	const inh = inheritedFormOf(uniqueId);
	return inh && skillmeta[inh] ? skillmeta[inh].groupId : null;
}

export function getNullUmaRow(e) {
	return {key: e.key, uniqueValue: 0, awakenValue: 0, pending: true};
}

// Aptitude letters relevant to this course, shown for information only.
export function aptitudesForCourse(entry, course: CourseData) {
	const styleIdx = STRATEGIES.indexOf(entry.strategy) - 1;  // aptitude for the style being simulated
	return {
		distance: entry.aptitudes[course.distanceType - 1],
		surface: entry.aptitudes[7 + course.surface],
		style: styleIdx >= 0 ? entry.aptitudes[4 + styleIdx] : '-'
	};
}

const APT_CLASS = {S: 'aptS', A: 'aptA', B: 'aptB', C: 'aptC', D: 'aptD', E: 'aptE', F: 'aptF', G: 'aptG'};

const UmaNameCell = memo(function UmaNameCell(props) {
	// icons.json is keyed by BOTH uma id and outfit id, but with different value
	// shapes: uma ids map to a plain string, outfit ids to a [untrained, trained]
	// pair. Index into the outfit entry, and fall back to the uma-level string.
	const entry = icons[props.outfitId];
	const ic = Array.isArray(entry) ? entry[1] : icons[props.umaId];
	return (
		<div class="rankUmaName">
			{typeof ic == 'string' && <img src={`/uma-tools/icons/chara/${ic}.png`} loading="lazy" />}
			<span class="rankUmaEpithet">{props.epithet}</span>
			<span>{props.name}</span>
		</div>
	);
});

function Apt(props) {
	return <span class={`aptBadge ${APT_CLASS[props.a] || ''}`}>{props.a}</span>;
}

function formatValue(info) {
	const row = info.row.original;
	if (row.pending) return <span class="rankPending">—</span>;
	const v = info.getValue();
	// a tiny negative rounds to "-0.00", which reads as a real loss. Snap it to zero.
	const shown = Math.abs(v) < 0.005 ? 0 : v;
	return <span>{shown.toFixed(2)} L</span>;
}

// The raw activation condition, lightly humanised. Shown on hover so a 0.00 L
// reads as "needs three recovery skills" instead of looking like a bug.
const CONDITION_HINTS = {
	activate_count_heal: 'recovery skills activated',
	activate_count_middle: 'skills activated in the middle phase',
	activate_count_start: 'skills activated in the opening phase',
	activate_count_all: 'skills activated',
	activate_count_later_half: 'skills activated in the second half',
	activate_count_end_after: 'skills activated in the final phase'
};

export function conditionText(id: string) {
	const alts = skilldata[id] && skilldata[id].alternatives;
	if (!alts) return '';
	const conds = alts.map(a => a.condition).filter(Boolean);
	return Array.from(new Set(conds)).join('  OR  ');
}

export function conditionHint(id: string) {
	const raw = conditionText(id);
	if (!raw) return '';
	const parts = [];
	Object.keys(CONDITION_HINTS).forEach(k => {
		const m = raw.match(new RegExp(k + '>=(\\d+)'));
		if (m) parts.push(`needs ${m[1]} ${CONDITION_HINTS[k]}`);
	});
	if (/running_style==1/.test(raw)) parts.push('Front Runner only');
	if (/running_style==2/.test(raw)) parts.push('Pace Chaser only');
	if (/running_style==3/.test(raw)) parts.push('Late Surger only');
	if (/running_style==4/.test(raw)) parts.push('End Closer only');
	if (/distance_type==1/.test(raw)) parts.push('Sprint courses only');
	if (/distance_type==2/.test(raw)) parts.push('Mile courses only');
	if (/distance_type==3/.test(raw)) parts.push('Medium courses only');
	if (/distance_type==4/.test(raw)) parts.push('Long courses only');
	return (parts.length ? parts.join('; ') + '\n\n' : '') + raw;
}

function AwakeningDetail(props) {
	const rows = props.ids.map(id => {
		const v = props.values.get(id);
		return {id, value: v == null ? null : v.value, fired: v == null ? null : v.fired, samples: v == null ? 0 : v.samples};
	});
	rows.sort((a, b) => (b.value == null ? -Infinity : b.value) - (a.value == null ? -Infinity : a.value));
	const pending = rows.every(r => r.value == null);
	const cov = props.covered || [];
	const skipped = (props.allIds || []).filter(id => props.ids.indexOf(id) < 0 && cov.indexOf(id) < 0);
	return (
		<div class="rankDetail">
			<div class="rankDetailTitle">
				Awakening skills{pending ? ' (simulating\u2026)' : ''}
			</div>
			{rows.map(r => (
				<div class="rankDetailSkill" key={r.id}>
					{skillmeta[r.id] && <img src={`/uma-tools/icons/skill/utx_ico_skill_${skillmeta[r.id].iconId}.png`} loading="lazy" />}
					<span class="rankDetailName">
						<Text id={`skillnames.${r.id}`}>{skillnames[r.id] ? skillnames[r.id][0] : r.id}</Text>
					</span>
					{r.value != null && r.fired === 0 &&
						<span class="rankNeverBadge" title={conditionHint(r.id)}>never fired</span>}
					{r.value != null && r.fired > 0 && r.fired < r.samples &&
						<span class="rankRateBadge" title={conditionHint(r.id)}>
							{Math.round(100 * r.fired / r.samples)}%</span>}
					<span class="rankDetailValue">{r.value == null ? '\u2014'
						: (Math.abs(r.value) < 0.005 ? 0 : r.value).toFixed(2) + ' L'}</span>
				</div>
			))}
			{(props.covered || []).length > 0 &&
				<div class="rankDetailSkipped">
					Already on your uma at the same or better grade:{' '}
					{props.covered.map(id => (
						<span key={id} class="rankSkippedName">
							<Text id={`skillnames.${id}`}>{skillnames[id] ? skillnames[id][0] : id}</Text>
						</span>
					))}
				</div>}
			{skipped.length > 0 &&
				<div class="rankDetailSkipped">
					Cannot activate on this track / style:{' '}
					{skipped.map(id => (
						<span key={id} class="rankSkippedName" title={conditionHint(id)}>
							<Text id={`skillnames.${id}`}>{skillnames[id] ? skillnames[id][0] : id}</Text>
						</span>
					))}
				</div>}
		</div>
	);
}

const APT_ORDER = 'GFEDCBAS';
function aptSort(a, b) {
	const x = APT_ORDER.indexOf(a.getValue(a.column.id) as string);
	const y = APT_ORDER.indexOf(b.getValue(b.column.id) as string);
	return +(y < x) - +(x < y);
}

const DISTANCE_NAMES = ['Sprint', 'Mile', 'Medium', 'Long'];
const SURFACE_NAMES = ['', 'Turf', 'Dirt'];

export function UmaRankChart(props) {
	const course = props.course;
	const distanceLabel = `Distance aptitude \u2014 ${DISTANCE_NAMES[course.distanceType - 1]} (${course.distance}m)`;
	const detailKey = props.detail ? props.detail.key : '';
	const surfaceLabel = `Surface aptitude \u2014 ${SURFACE_NAMES[course.surface]}`;

	const columns = useMemo(() => [{
		header: (c) => <span onClick={c.header.column.getToggleSortingHandler()}>Uma</span>,
		accessorKey: 'name',
		cell: (info) => {
			const r = info.row.original;
			return <UmaNameCell umaId={r.umaId} outfitId={r.outfitId} name={r.name} epithet={r.epithet} />;
		},
		sortFn: (a, b) => a.getValue('name') < b.getValue('name') ? -1 : 1
	}, {
		header: (c) => <span onClick={c.header.column.getToggleSortingHandler()}>Running style</span>,
		accessorKey: 'strategy',
		cell: (info) => {
			const r = info.row.original;
			return <span title={r.isDefaultStrategy ? "This uma's own running style" : ''}>
				{STRATEGY_LABELS[info.getValue()] || info.getValue()}</span>;
		},
		sortFn: (a, b) => a.getValue('strategy') < b.getValue('strategy') ? -1 : 1
	}, {
		header: () => <span title={distanceLabel}>Dist</span>,
		id: 'aptDistance',
		accessorFn: (row) => row.apt.distance,
		cell: (info) => <Apt a={info.getValue()} />,
		sortFn: aptSort
	}, {
		header: () => <span title={surfaceLabel}>Surf</span>,
		id: 'aptSurface',
		accessorFn: (row) => row.apt.surface,
		cell: (info) => <Apt a={info.getValue()} />,
		sortFn: aptSort
	}, {
		header: () => <span title="Aptitude for this uma's own running style">Style</span>,
		id: 'aptStyle',
		accessorFn: (row) => row.apt.style,
		cell: (info) => <Apt a={info.getValue()} />,
		sortFn: aptSort
	}, {
		header: (c) => <span onClick={c.header.column.getToggleSortingHandler()}>Unique</span>,
		accessorKey: 'uniqueValue',
		cell: (info) => {
			const r = info.row.original;
			return <span>
				{formatValue(info)}
				{r.uniqueNeverFired && !r.pending &&
					<span class="rankNeverBadge" title={conditionHint(r.unique)}>never fired</span>}
				{r.replacesInherited &&
					<span class="rankSwapBadge" title="Your uma is carrying this uma's inherited unique. The value shown is for swapping that out for the real one, since they cannot both be equipped.">swap</span>}
			</span>;
		},
		sortDescFirst: true
	}, {
		header: (c) => <span onClick={c.header.column.getToggleSortingHandler()}>Awakening</span>,
		accessorKey: 'awakenValue',
		cell: (info) => {
			const r = info.row.original;
			return <span>
				{formatValue(info)}
				{r.coveredAwakenings && r.coveredAwakenings.length > 0 &&
					<span class="rankHaveBadge"
						title={'Already on your uma at the same or better grade, so it adds nothing here:\n' +
							r.coveredAwakenings.map(id => (skillnames[id] ? skillnames[id][skillnames[id].length - 1] : id)).join('\n')}>
						{r.coveredAwakenings.length}× have</span>}
				{!r.pending && r.awakenNeverFired > 0 &&
					<span class="rankNeverBadge"
						title={`${r.awakenNeverFired} of ${r.awakenSimulated} simulated awakening skills never met their condition. Open the row for details.`}>
						{r.awakenNeverFired}× idle</span>}
			</span>;
		},
		sortDescFirst: true
	}, {
		header: (c) => <span onClick={c.header.column.getToggleSortingHandler()}>Total</span>,
		id: 'total',
		accessorFn: (row) => row.uniqueValue + row.awakenValue,
		cell: formatValue,
		sortDescFirst: true
	}], [distanceLabel, surfaceLabel]);

	const [sorting, setSorting] = useState<SortingState>([{id: 'uniqueValue', desc: true}]);

	const table = useTable({
		_features: tableFeatures({rowSortingFeature}),
		_rowModels: {sortedRowModel: createSortedRowModel(sortFns)},
		columns,
		data: props.data,
		onSortingChange: setSorting,
		enableSortingRemoval: false,
		state: {sorting}
	});

	function handleClick(e) {
		const tr = e.target.closest('tr');
		if (tr == null || tr.dataset.umakey == null) return;
		e.stopPropagation();
		props.onSelectRow && props.onSelectRow(tr.dataset.umakey);
	}

	function handleDblClick(e) {
		const tr = e.target.closest('tr');
		if (tr == null) return;
		e.stopPropagation();
		props.onDblClickRow && props.onDblClickRow(tr.dataset.umakey);
	}

	return (
		<div class={`umaRankChartWrapper${props.dirty ? ' dirty' : ''}`} data-umarank-build={UMARANK_BUILD}>
			<table class="umaRankChart">
				<thead>
					{table.getHeaderGroups().map(headerGroup => (
						<tr key={headerGroup.id}>
							{headerGroup.headers.map(header => (
								<th key={header.id} colSpan={header.colSpan}>
									{!header.isPlaceholder && (
										<div class={`columnHeader ${({
											'asc': 'umaRankSortedAsc',
											'desc': 'umaRankSortedDesc',
											'false': ''
										})[header.column.getIsSorted()]}`}>
											{flexRender(header.column.columnDef.header, header.getContext())}
										</div>
									)}
								</th>
							))}
						</tr>
					))}
				</thead>
				<tbody onClick={handleClick} onDblClick={handleDblClick}>
					{table.getRowModel().rows.map(row => {
						const open = row.original.key == detailKey;
						return (
							<Fragment key={row.id}>
								<tr data-umakey={row.original.key} class={open ? 'selected' : ''}>
									{row.getAllCells().map(cell => (
										<td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
									))}
								</tr>
								{open && (
									<tr class="rankDetailRow">
										<td colSpan={row.getAllCells().length}>
											<AwakeningDetail ids={props.detail.simulated || row.original.awakenings}
												allIds={row.original.awakenings} covered={row.original.coveredAwakenings}
												values={props.detail.data} />
										</td>
									</tr>
								)}
							</Fragment>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}
