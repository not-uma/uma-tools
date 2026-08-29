// Adds a "Base uniques" option to the Skill table filter, by editing the
// PREBUILT minified bundle.js that ships in the repo. This keeps the
// maintainer's newer engine (unique skill levels, otherHorse, Lead Compete)
// instead of rebuilding against the older public uma-skill-tools.
//
// Usage, from the uma-tools folder:
//     node patch-bundle.mjs umalator-global
//     node patch-bundle.mjs umalator
//
// Writes bundle.patched.js next to bundle.js and does not modify the original.

import * as fs from 'node:fs';
import * as path from 'node:path';

const dir = process.argv[2] || 'umalator-global';
const bundlePath = path.join(dir, 'bundle.js');
const outPath = path.join(dir, 'bundle.patched.js');

if (!fs.existsSync(bundlePath)) {
	console.error(`no bundle.js in ${dir}/ -- run this from the uma-tools folder`);
	process.exit(1);
}

// Prefer the tool's own skill_data.json (global has its own copy).
const dataPath = fs.existsSync(path.join(dir, 'skill_data.json'))
	? path.join(dir, 'skill_data.json')
	: path.join('uma-skill-tools', 'data', 'skill_data.json');
const skilldata = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

const NOT_REAL_UNIQUES = ['1400011', '1400021'];
const uniques = Object.keys(skilldata).filter(id =>
	NOT_REAL_UNIQUES.indexOf(id) == -1 && id[0] != '9' && skilldata[id].rarity >= 4);
console.log(`${dir}: ${uniques.length} base uniques from ${dataPath}`);

let src = fs.readFileSync(bundlePath, 'utf8');
let applied = 0;

function patch(name, find, make) {
	const m = src.match(find);
	if (!m) { console.error(`  FAILED: ${name} -- pattern not found`); return; }
	const all = src.match(new RegExp(find.source, find.flags.replace('g', '') + 'g'));
	if (all && all.length > 1) { console.error(`  FAILED: ${name} -- ${all.length} matches, ambiguous`); return; }
	src = src.replace(find, make(m));
	applied++;
	console.log(`  ok: ${name}`);
}

// 1. the chart-mode switch: add a 'unique' case returning the hardcoded list
patch('skill list switch',
	/case"inherit":return (\w+)\.filter\((\w+)=>\2\[0\]=="9"\);/,
	m => `${m[0]}case"unique":return ${JSON.stringify(uniques)};`);

// 2. the radio button, cloned from the existing "inherit" one
patch('radio button',
	/(\w+)\("div",null,\1\("input",\{type:"radio",id:"basinnChartSelectInherit",name:"basinnChartSelection",value:"inherit",checked:(\w+)=="inherit",onClick:(\w+)\}\),\1\("label",\{for:"basinnChartSelectInherit"\},\1\((\w+),\{id:"ui\.basinnchartselection\.inherit"\}\)\)\)/,
	m => {
		const [, el, mode, onClick, Text] = m;
		return `${m[0]},${el}("div",null,${el}("input",{type:"radio",id:"basinnChartSelectUnique",` +
			`name:"basinnChartSelection",value:"unique",checked:${mode}=="unique",onClick:${onClick}}),` +
			`${el}("label",{for:"basinnChartSelectUnique"},${el}(${Text},{id:"ui.basinnchartselection.unique"})))`;
	});

// 3. the English label
patch('en label',
	/inherit:"Inherited uniques",selected:"Selected skills"/,
	m => 'inherit:"Inherited uniques",unique:"Base uniques",selected:"Selected skills"');

// 4. the Japanese label (absent from the global build; that is fine)
patch('ja label',
	/inherit:"継承固有スキル",selected:"選択したスキル"/,
	m => 'inherit:"継承固有スキル",unique:"固有スキル",selected:"選択したスキル"');

fs.writeFileSync(outPath, src);
console.log(`${applied} patches applied -> ${outPath}`);
