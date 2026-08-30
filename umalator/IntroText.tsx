import { h } from 'preact';
import './IntroText.css';

export function IntroText(props) {
	return (
		<div id="introtext">
			<details>
				<summary>Caveats</summary>
				The simulator is fairly complete and implements nearly all relevant game mechanics, with the following exceptions:
				<ul>
					<li>
						<details>
							<summary>Pseudo-random skills based on the location of other umas use a best-effort estimation for the distribution of their activation locations which may not be perfectly reflective of in-game behavior in all circumstances</summary>
							<p>Skills that have conditions that require you to be blocked, are based on other umas in your proximity, etc, are modeled according to statistical distributions intended to simulate their in-game behavior but may not be perfectly accurate. It should always find the correct minimum and maximum but the reported mean and median should sometimes be taken with a grain of salt. For example skills with blocked conditions are generally better in races with more umas and worse with fewer. Use your better judgement.</p>
							<p>Skills with conditions with <code>_random</code> in the name (e.g. <code>phase_random</code>, <code>corner_random</code>, <code>straight_random</code>) are implemented identically to the in-game logic and will have more accurate mean/median values, as are skills based purely on the course geometry with no blocked front/side/surrounded conditions.</p>
						</details>
					</li>
					<li>
						<details>
							<summary>Skill cooldowns are not implemented</summary>
							Skills only ever activate once even if they have a cooldown like Professor of Curvature or Beeline Burst.
						</details>
					</li>
					<li>
						<details>
							<summary>Speed up mode on Front Runners is not implemented</summary>
							Front Runners have a chance to temporarily speed up based on their wit stat. This is difficult to model and not useful for skill comparisons so it is not implemented, but consider that wit on Front Runners is very slightly more useful than the simulator reports.
						</details>
					</li>
				</ul>
				By and large it should be highly accurate. It has been battle-tested on the JP server for several years.
			</details>

			<details open={true}>
				<summary>Changelog</summary>
				<section>
					<h2>2026-08-30 (fork)</h2>
					<ul>
						<li>
							<details>
								<summary>New Uma ranking tab</summary>
								<ul>
									<li>Evaluates every uma on the selected track, scoring their unique skill and their awakening skills separately</li>
									<li>Every uma is tried under all four running styles, so the table shows which style suits each one rather than assuming her default</li>
									<li>Aptitudes are shown per row for reference, but are not used when scoring the skills</li>
									<li>Awakening skills use the fully upgraded form of each skill line</li>
									<li>Click a row to expand a per-skill breakdown with activation rates, plus skills that could not activate on the track or are already on your uma</li>
									<li>Optional toggle to include the skills currently on your uma, so values reflect what a skill adds on top of your existing build</li>
									<li>With that toggle on, an inherited unique is swapped out rather than stacked, since an uma cannot carry both</li>
									<li>Filter which running styles are simulated</li>
								</ul>
							</details>
						</li>

						<li>
							<details>
								<summary>Performance</summary>
								<ul>
									<li>Skill activation scan no longer walks every pending skill on every frame, roughly halving simulation time</li>
									<li>Per-frame telemetry is skipped for runs that never display a chart</li>
									<li>Worker count now scales to the number of CPU cores instead of being fixed at four</li>
									<li>Simulation results are unchanged; verified identical across 1080 seeded cases</li>
								</ul>
							</details>
						</li>

						<li>Run button now shows progress while running, can be used to stop a run, and reports how long the run took</li>
						<li>Race presets are now numbered by Champions Meeting, and cover CM 1 through CM 24</li>
						<li>Your umas, track and settings are remembered between visits</li>
					</ul>
				</section>

				{/* rest of file unchanged */}
				<footer id="sourcelinks">
					Forked from: <a href="https://github.com/alpha123/uma-skill-tools">simulator</a>, <a href="https://github.com/alpha123/uma-tools">UI</a>
				</footer>
			</details>
		</div>
	);
}