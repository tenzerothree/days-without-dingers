const BASE = 'https://statsapi.mlb.com/api/v1';
const VLADDY_ID = 665489;
const TOR_ID = 141;
const SEASON = new Date().getFullYear();

const teamEl = document.getElementById('team');
const playerEl = document.getElementById('player');
const headshotEl = document.getElementById('headshot');
const headerEl = document.getElementById('header');
const subHeaderEl = document.getElementById('sub-header');
const statsEl = document.getElementById('stats');
const headshotLinkEl = document.getElementById('headshot-link');

const params = new URLSearchParams(location.search);

function fmtRate(val) {
	if (val == null) return '—';
	const n = Number(val);
	const s = n.toFixed(3);
	return n < 1 ? s.replace(/^0/, '') : s;
}

async function loadTeams() {
	const res = await fetch(`${BASE}/teams?sportId=1&season=${SEASON}`);
	const data = await res.json();
	const teams = data.teams
		.filter(t => t.sport?.id === 1)
		.sort((a, b) => a.name.localeCompare(b.name));

	teams.forEach(t => {
		const opt = document.createElement('option');
		opt.value = t.id;
		opt.dataset.code = t.fileCode;
		opt.textContent = t.name;
		teamEl.appendChild(opt);
	});

	const saved = params.get('team');
	teamEl.value = saved && [...teamEl.options].some(o => o.value === saved) ? saved : TOR_ID;

	setTeamColor();
	await loadRoster(teamEl.value);
}

function setTeamColor() {
	const code = teamEl.options[teamEl.selectedIndex]?.dataset.code;
	document.body.style.background = code ? `var(--mlb-${code})` : '#000';
}

async function loadRoster(teamId) {
	playerEl.innerHTML = '';
	const res = await fetch(`${BASE}/teams/${teamId}/roster/40Man?season=${SEASON}`);
	const data = await res.json();

	const pitcherPos = new Set(['P', 'SP', 'RP']);
	const hitters = (data.roster || [])
		.filter(p => !pitcherPos.has(p.position.abbreviation))
		.sort((a, b) => {
			const lastName = n => n.split(' ').slice(1).join(' ') || n;
			return lastName(a.person.fullName).localeCompare(lastName(b.person.fullName));
		});

	hitters.forEach(p => {
		const opt = document.createElement('option');
		opt.value = p.person.id;
		const statusCode = p.status?.code ?? '';
		const statusDesc = p.status?.description ?? '';
		const onIL = statusCode.includes('IL') || statusCode.includes('DL') || statusDesc.toLowerCase().includes('injured');
		opt.dataset.il = onIL ? '1' : '';
		opt.textContent = onIL ? `${p.person.fullName} (IL)` : p.person.fullName;
		playerEl.appendChild(opt);
	});

	const saved = params.get('player');
	if (saved && [...playerEl.options].some(o => o.value === saved)) {
		playerEl.value = saved;
	} else if (String(teamId) === String(TOR_ID) && [...playerEl.options].some(o => o.value == VLADDY_ID)) {
		playerEl.value = VLADDY_ID;
	}

	await loadPlayerStats(playerEl.value);
}

async function loadPlayerStats(playerId) {
	headerEl.textContent = 'Loading…';
	subHeaderEl.textContent = '';
	statsEl.textContent = '';
	headshotEl.style.opacity = '0';
	headshotEl.onload = () => { headshotEl.style.opacity = '1'; };
	headshotEl.src = `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:silo:current.png/w_240,q_auto/v1/people/${playerId}/headshot/silo/current`;

	const [seasonRes, logRes] = await Promise.all([
		fetch(`${BASE}/people/${playerId}/stats?stats=season&season=${SEASON}&gameType=R&group=hitting`),
		fetch(`${BASE}/people/${playerId}/stats?stats=gameLog&season=${SEASON}&gameType=R&group=hitting`)
	]);

	const [seasonData, logData] = await Promise.all([seasonRes.json(), logRes.json()]);

	const selectedOpt = playerEl.options[playerEl.selectedIndex];
	const playerName = selectedOpt?.textContent.replace(' (IL)', '') ?? '';
	const firstName = playerName.split(' ')[0];
	const onIL = selectedOpt?.dataset.il === '1';
	headshotLinkEl.href = `https://www.fangraphs.com/search?q=${encodeURIComponent(playerName)}`;

	const stat = seasonData.stats?.[0]?.splits?.[0]?.stat;
	const games = stat?.gamesPlayed ?? '—';
	const pa = stat?.plateAppearances ?? '—';
	const hr = stat?.homeRuns ?? '—';
	const obp = fmtRate(stat?.obp);
	const slg = fmtRate(stat?.slg);

	let wrcPlus = '—';
	if (stat) {
		const bb = (stat.baseOnBalls ?? 0) - (stat.intentionalWalks ?? 0);
		const hbp = stat.hitByPitch ?? 0;
		const s1b = (stat.hits ?? 0) - (stat.doubles ?? 0) - (stat.triples ?? 0) - (stat.homeRuns ?? 0);
		const denom = (stat.atBats ?? 0) + bb + (stat.intentionalWalks ?? 0) + (stat.sacFlies ?? 0) + hbp;
		if (denom > 0) {
			const woba = (GUTS.wBB * bb + GUTS.wHBP * hbp + GUTS.w1B * s1b + GUTS.w2B * (stat.doubles ?? 0) + GUTS.w3B * (stat.triples ?? 0) + GUTS.wHR * (stat.homeRuns ?? 0)) / denom;
			wrcPlus = Math.round(((woba - GUTS.lgwOBA) / GUTS.wOBAScale + GUTS.lgRPA) / GUTS.lgRPA * 100);
		}
	}

	const splits = logData.stats?.[0]?.splits ?? [];
	let lastHrIndex = -1;
	for (let i = 0; i < splits.length; i++) {
		if ((splits[i].stat?.homeRuns ?? 0) > 0) lastHrIndex = i;
	}

	if (lastHrIndex >= 0) {
		const lastHrDate = splits[lastHrIndex].date;
		const splitsSince = splits.slice(lastHrIndex + 1);
		const gamesSinceHr = splitsSince.length;
		const hrGamePAs = (splits[lastHrIndex].stat?.plateAppearances ?? 0) - (splits[lastHrIndex].stat?.homeRuns ?? 0);
		const paSinceHr = hrGamePAs + splitsSince.reduce((sum, s) => sum + (s.stat?.plateAppearances ?? 0), 0);

		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const hrDay = new Date(lastHrDate + 'T00:00:00');
		const days = Math.round((today - hrDay) / 864e5);

		const daysStr = days === 1 ? '1 day' : `${days} days`;
		if (days === 0) {
			headerEl.textContent = onIL
				? `${firstName} is on the IL, but hit a home run today`
				: `${firstName} hit a home run today`;
		} else {
			headerEl.textContent = onIL
				? `${firstName} is on the IL, but it's been ${daysStr} since they hit a home run`
				: `It's been ${daysStr} since ${firstName} hit a home run`;
		}
		subHeaderEl.textContent = `${gamesSinceHr} games and ${paSinceHr} plate appearances without a home run`;
	} else {
		headerEl.textContent = `${firstName} hasn't hit a home run this season`;
		subHeaderEl.textContent = `Across ${games} games and ${pa} plate appearances this season`;
	}
	statsEl.textContent = `${hr} HR  •  ${games} G  •  ${pa} PA  •  ${obp} OBP  •  ${slg} SLG  •  ${wrcPlus} wRC+`;
	document.title = `Days Without Dinger – When was ${firstName}'s last HR?`;
	setUrlParams();
}

function setUrlParams() {
	const p = new URLSearchParams();
	p.set('team', teamEl.value);
	p.set('player', playerEl.value);
	history.replaceState(null, '', '?' + p.toString());
}

teamEl.addEventListener('change', () => { setTeamColor(); loadRoster(teamEl.value); });
playerEl.addEventListener('change', () => loadPlayerStats(playerEl.value));

loadTeams();

const infoBtn = document.getElementById('info-btn');
const modalOverlay = document.getElementById('modal-overlay');
const modalClose = document.getElementById('modal-close');

infoBtn.addEventListener('click', () => modalOverlay.classList.add('open'));
modalClose.addEventListener('click', () => modalOverlay.classList.remove('open'));
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) modalOverlay.classList.remove('open'); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') modalOverlay.classList.remove('open'); });
