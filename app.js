// ===== Service worker registreren =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(console.error);
  });
}

/* =======================================================================
   BASIS APP STATE + SCOUTING LOGICA
   ======================================================================= */

// ====== STATE ======
const counters = {
  interceptions: 0,
  assists: 0,
  goals: 0,
  attempts: 0,
  goodPasses: 0,
  badPasses: 0,
  goalsAgainst: 0,
  goalsDefended: 0
};

const LIVE_STATE_KEY = 'liveStateV1';
const FORCE_SETUP_KEY = 'forceShowSetupV1';
let currentOpponent = ''; // per match (niet in settings)

const history = [];
let playtime = 0; // in seconden
let playtimeInterval = null;
let isPlaying = false;
let savedScoutings = [];
let isGoalkeeper = false;

// ====== HELPERS ======
function $(id){ return document.getElementById(id); }

function hasProgress(){
  if (playtime > 0) return true;
  for (const k in counters){ if (counters[k] > 0) return true; }
  return false;
}

function stopTimerIfRunning(){
  if (isPlaying) {
    isPlaying = false;
    if (playtimeInterval) {
      clearInterval(playtimeInterval);
      playtimeInterval = null;
    }
  }
}

// ====== UI ======
function updatePlayerInfoCompact() {
  const playerName   = $('playerName')?.value || '';
  const playerNumber = $('playerNumber')?.value || '';
  const ownTeam      = $('ownTeam')?.value || '';
  const opp          = currentOpponent || '';

  let infoText = '';
  if (playerName) {
    infoText += playerName;
    if (playerNumber) infoText += ` (#${playerNumber})`;
  }
  if (ownTeam) {
    if (infoText) infoText += ' | ';
    infoText += ownTeam;
  }
  if (opp) {
    if (infoText) infoText += ' vs ';
    infoText += opp;
  }
  $('playerInfoCompact') && ($('playerInfoCompact').textContent = infoText || 'No player information');
}

function toggleButtons(enabled) {
  [
    'interceptionBtn','interceptionMinusBtn',
    'assistBtn','assistMinusBtn',
    'goalBtn','goalMinusBtn',
    'attemptBtn','attemptMinusBtn',
    'goodPassBtn','goodPassMinusBtn',
    'badPassBtn','badPassMinusBtn',
    'addMinuteBtn','subtractMinuteBtn',
    'goalsAgainstBtn','goalsAgainstMinusBtn',
    'goalsDefendedBtn','goalsDefendedMinusBtn'
  ].forEach(id => { const b = $(id); if (b) b.disabled = !enabled; });
}

// ====== Keeper UI ======
function toggleGoalkeeperButtons() {
  isGoalkeeper = $('isGoalkeeper')?.checked || false;
  const keeperSection = $('goalkeeperSection');
  const keeperButtons = $('goalkeeperButtons');
  const goalsAgainstText = $('goalsAgainstText');
  const goalsDefendedText = $('goalsDefendedText');

  if (!keeperSection || !keeperButtons) return;

  if (isGoalkeeper) {
    keeperSection.style.display = 'block';
    keeperButtons.style.display = 'grid';
    if (goalsAgainstText) goalsAgainstText.style.display = 'block';
    if (goalsDefendedText) goalsDefendedText.style.display = 'block';
  } else {
    keeperSection.style.display = 'none';
    keeperButtons.style.display = 'none';
    if (goalsAgainstText) goalsAgainstText.style.display = 'none';
    if (goalsDefendedText) goalsDefendedText.style.display = 'none';
    counters.goalsAgainst = 0;
    counters.goalsDefended = 0;
    updateDisplay('goalsAgainst');
    updateDisplay('goalsDefended');
  }
}

// ====== Startscherm ======
function showSetupScreen() {
  const setup = $('setupScreen');
  const main  = $('mainContent');
  if (setup) setup.style.display = 'block';
  if (main)  main.style.display  = 'none';

  const copyVal = (fromId, toId) => {
    const from = $(fromId); const to = $(toId);
    if (from && to) to.value = from.value || '';
  };
  copyVal('playerName', 'setupPlayerName');
  copyVal('playerNumber', 'setupPlayerNumber');
  copyVal('ownTeam', 'setupOwnTeam');

  const gkSetup = $('setupIsGoalkeeper');
  if (gkSetup && $('isGoalkeeper')) gkSetup.checked = !!$('isGoalkeeper').checked;

  if ($('setupOpponent')) $('setupOpponent').value = ''; // altijd leeg bij nieuwe match
}

function saveSetup() {
  const getVal = (id) => $(id)?.value?.trim() || '';
  const getChecked = (id) => !!$(id)?.checked;

  const playerName   = getVal('setupPlayerName');
  const playerNumber = getVal('setupPlayerNumber');
  const ownTeam      = getVal('setupOwnTeam');
  const opponent     = getVal('setupOpponent'); // optioneel
  const isGK         = getChecked('setupIsGoalkeeper');

  if (!playerName || !playerNumber || !ownTeam) {
    alert("Fill in player, number and your team to start scouting!");
    return;
  }

  // schrijf naar Settings (Modify-tab)
  if ($('playerName'))   $('playerName').value   = playerName;
  if ($('playerNumber')) $('playerNumber').value = playerNumber;
  if ($('ownTeam'))      $('ownTeam').value      = ownTeam;
  if ($('isGoalkeeper')) $('isGoalkeeper').checked = isGK;

  // opponent: runtime
  currentOpponent = opponent || '';

  // persist settings (zonder opponent)
  localStorage.setItem('playerName', playerName);
  localStorage.setItem('playerNumber', playerNumber);
  localStorage.setItem('ownTeam', ownTeam);
  localStorage.setItem('isGoalkeeper', isGK);

  updatePlayerInfoCompact();
  toggleGoalkeeperButtons();

  // scherm wisselen
  if ($('setupScreen')) $('setupScreen').style.display = 'none';
  if ($('mainContent')) $('mainContent').style.display = 'block';

  saveLiveState();
}

// ====== New game / reset ======
function resetAll(){
  stopTimerIfRunning();

  for (const key in counters) {
    counters[key] = 0;
    const el = $(key);
    if (el) el.textContent = '0';
  }

  playtime = 0;
  typeof updatePlaytimeDisplay === 'function' && updatePlaytimeDisplay();

  history.length = 0;
  typeof updateStats === 'function' && updateStats();

  const playtimeBtn = $('playtimeBtn');
  if (playtimeBtn) {
    playtimeBtn.textContent = "Player is in the substitution zone";
    playtimeBtn.classList.remove('playing');
    playtimeBtn.classList.add('not-playing');
  }
}

function resetAndShowSetup(){
  resetAll();
  toggleButtons(false);

  currentOpponent = '';
  localStorage.removeItem(LIVE_STATE_KEY);
  localStorage.setItem(FORCE_SETUP_KEY, '1');

  const setup = $('setupScreen');
  const main  = $('mainContent');
  if (setup) setup.style.display = 'block';
  if (main)  main.style.display  = 'none';
  if ($('setupOpponent')) $('setupOpponent').value = '';

  window.scrollTo({ top: 0, behavior: 'instant' });
}

// ====== Modify-tab acties ======
function savePlayerFromModify(){
  const playerName   = $('playerName')?.value?.trim() || '';
  const playerNumber = $('playerNumber')?.value?.trim() || '';
  const ownTeam      = $('ownTeam')?.value?.trim() || '';
  const isGK         = $('isGoalkeeper')?.checked || false;

  localStorage.setItem('playerName', playerName);
  localStorage.setItem('playerNumber', playerNumber);
  localStorage.setItem('ownTeam', ownTeam);
  localStorage.setItem('isGoalkeeper', isGK);

  updatePlayerInfoCompact();
  toggleGoalkeeperButtons();
  alert('Player saved!');
  saveLiveState();
}

// ====== Einde wedstrijd ======
function endGame() {
  const ok = confirm("End match and save the scouting?");
  if (!ok) return;

  const endBtn = $('endGameBtn');
  if (endBtn) endBtn.disabled = true;

  try {
    if (isPlaying) {
      togglePlaytime();
    } else {
      toggleButtons(false);
    }

    const playerName   = $('playerName')?.value || '';
    const playerNumber = $('playerNumber')?.value || '';
    const ownTeam      = $('ownTeam')?.value || '';

    if (!playerName) { alert("Please enter the player's name!"); return; }

    updatePlaytimeDisplay(); // final tick

    const totalPasses   = (counters.goodPasses || 0) + (counters.badPasses || 0);
    const passAccuracy  = totalPasses > 0 ? Math.round((counters.goodPasses / totalPasses) * 100) : 0;
    const totalShots    = (counters.goals || 0) + (counters.attempts || 0);
    const shotAccuracy  = totalShots > 0 ? Math.round((counters.goals / totalShots) * 100) : 0;
    const savePct       = calcSavePct(counters);
    const minutesPlayed = playtime / 60;
    const involvement   = minutesPlayed > 0
      ? involvementPerMinute(counters, minutesPlayed, { passesIncludeAssists: true })
      : 0.0;

    const scouting = {
      id: Date.now(),
      date: new Date().toLocaleString('nl-NL'),
      playerName, playerNumber, ownTeam,
      opponent: currentOpponent,
      playtime, isGoalkeeper,
      stats: { ...counters },
      totals: { totalPasses, passAccuracy, shotAccuracy, involvement, savePct }
    };

    savedScoutings.push(scouting);
    localStorage.setItem('savedScoutings', JSON.stringify(savedScoutings));
    updateScoutingsList();

    alert(`Game of ${playerName} is saved!`);

    // Naar Stats
    switchTab('stats');

    // Reset voor nieuwe match
    resetAll();
    localStorage.removeItem(LIVE_STATE_KEY);
  } finally {
    if (endBtn) endBtn.disabled = false;
  }
}

// ====== Metrics ======
function involvementPerMinute(counters, minutesPlayed, { passesIncludeAssists = true } = {}) {
  const m = +minutesPlayed || 0;
  if (m <= 0) return 0.0;

  const good = +counters.goodPasses || 0;
  const bad  = +counters.badPasses  || 0;
  const ast  = +counters.assists    || 0;
  const g    = +counters.goals      || 0;
  const att  = +counters.attempts   || 0;
  const ints = +counters.interceptions || 0;

  const passesTotal = good + bad;
  const passesExclAssists = passesIncludeAssists ? Math.max(0, passesTotal - ast) : passesTotal;

  const rawInvolvement = passesExclAssists + ast + att + g + ints;
  const perMin = rawInvolvement / m;
  return Math.round(perMin * 10) / 10;
}
function getTotalShots(c){ return (Number(c.goals) || 0) + (Number(c.attempts) || 0); }
function calcSavePct(c){
  const ga = (+c.goalsAgainst)  || 0;
  const sv = (+c.goalsDefended) || 0;
  const shots = ga + sv;
  return shots > 0 ? Math.round((sv / shots) * 100) : 0;
}

// ====== Scouting lijst ======
function updateScoutingsList() {
  const container = $('savedScoutings');
  if (!container) return;

  if (savedScoutings.length === 0) {
    container.innerHTML = '<p>No scouting reports saved yet.</p>';
    return;
  }
  container.innerHTML = '';

  const sorted = [...savedScoutings].sort((a,b)=>b.id-a.id);
  sorted.forEach(scouting => {
    const item = document.createElement('div');
    item.className = 'scouting-item';

    const minutes = Math.floor((scouting.playtime ?? 0) / 60);
    const seconds = (scouting.playtime ?? 0) % 60;
    const playtimeStr = `${minutes.toString().padStart(2,'0')}:${seconds.toString().padStart(2,'0')}`;

    const stats = scouting.stats || {};
    const raw =
      (stats.goodPasses ?? 0) + (stats.badPasses ?? 0) + (stats.goals ?? 0) +
      (stats.attempts ?? 0) + (stats.assists ?? 0) + (stats.interceptions ?? 0);

    const minutesPlayed = (scouting.playtime ?? 0) / 60;
    const fallbackInvolvement = minutesPlayed > 0 ? (raw / minutesPlayed).toFixed(1) : '0.0';

    const hasStoredInvolvement = scouting.totals && scouting.totals.involvement !== undefined && scouting.totals.involvement !== null;
    const involvementToShow = hasStoredInvolvement ? Number(scouting.totals.involvement).toFixed(1) : fallbackInvolvement;

    const totals = scouting.totals || {};
    const passAcc = totals.passAccuracy ?? 0;
    const shotAcc = totals.shotAccuracy ?? 0;
    const totalPasses = totals.totalPasses ?? ((stats.goodPasses ?? 0) + (stats.badPasses ?? 0));

    const ga = stats.goalsAgainst ?? 0;
    const sv = stats.goalsDefended ?? 0;
    const totalShots = (stats.goals ?? 0) + (stats.attempts ?? 0);
    const shotsFaced = ga + sv;
    const savedSavePct = (scouting.totals && typeof scouting.totals.savePct === 'number')
      ? scouting.totals.savePct : (shotsFaced > 0 ? Math.round((sv / shotsFaced) * 100) : 0);

    item.innerHTML = `
      <div class="scouting-header">
        <strong>${scouting.playerName ?? 'Unknown'}${scouting.playerNumber ? ` (#${scouting.playerNumber})` : ''}, time played: ${playtimeStr}</strong>
        <span></span>
        <button class="delete-btn" onclick="deleteScouting(${scouting.id})"><i class="fas fa-trash"></i></button>
      </div>
      <div class="scouting-date">${scouting.date ?? ''} | Tegen: ${scouting.opponent ?? ''}</div>
      <div class="scouting-details">
        <div class="scouting-detail-item"><span>Player involvement:</span> <span class="highlight-stat">${involvementToShow}</span> <span style="opacity:.7">/min</span></div>
        <div class="scouting-detail-item"><span>Passing accuracy:</span> <span class="highlight-stat">${passAcc}%</span></div>
        <div class="scouting-detail-item"><span>Shot accuracy:</span> <span class="highlight-stat">${shotAcc}%</span></div>
        <div class="scouting-detail-item"><span>Total passes:</span> <span>${totalPasses}</span></div>
        <div class="scouting-detail-item"><span>Good passes:</span> <span>${stats.goodPasses ?? 0}</span></div>
        <div class="scouting-detail-item"><span>Bad passes:</span> <span>${stats.badPasses ?? 0}</span></div>
        <div class="scouting-detail-item"><span>Total shots opponent goal:</span> <span>${totalShots}</span></div>
        <div class="scouting-detail-item"><span>Goals:</span> <span>${stats.goals ?? 0}</span></div>
        <div class="scouting-detail-item"><span>Goal attempts:</span> <span>${stats.attempts ?? 0}</span></div>
        <div class="scouting-detail-item"><span>Interceptions:</span> <span>${stats.interceptions ?? 0}</span></div>
        <div class="scouting-detail-item"><span>Assists:</span> <span>${stats.assists ?? 0}</span></div>
        ${scouting.isGoalkeeper ? `
          <div><strong>Goalkeeper: </strong></div>
          <div class="scouting-detail-item"><span>Save%:</span> <span class="highlight-stat">${savedSavePct}%</span></div>
          <div class="scouting-detail-item"><span>Total shots faced:</span> <span>${shotsFaced}</span></div>
          <div class="scouting-detail-item"><span>Goals defended:</span> <span>${sv}</span></div>
          <div class="scouting-detail-item"><span>Goals against:</span> <span>${ga}</span></div>
        ` : ''}
      </div>
    `;
    container.appendChild(item);
  });
}

function deleteScouting(id) {
  if (confirm("Are you sure you want to delete this scouting?")) {
    savedScoutings = savedScoutings.filter(s => s.id !== id);
    localStorage.setItem('savedScoutings', JSON.stringify(savedScoutings));
    updateScoutingsList();
  }
}

// ====== Settings load/save ======
function loadSettings() {
  const playerName = localStorage.getItem('playerName') || '';
  const playerNumber = localStorage.getItem('playerNumber') || '';
  const ownTeam = localStorage.getItem('ownTeam') || '';
  const halfDuration = localStorage.getItem('halfDuration') || '';
  const numberOfHalves = localStorage.getItem('numberOfHalves') || '';
  const isGoalkeeperSetting = localStorage.getItem('isGoalkeeper');

  if ($('playerName'))   $('playerName').value   = playerName;
  if ($('playerNumber')) $('playerNumber').value = playerNumber;
  if ($('ownTeam'))      $('ownTeam').value      = ownTeam;

  if (halfDuration && $('halfDuration')) $('halfDuration').value = halfDuration;
  if (numberOfHalves && $('numberOfHalves')) $('numberOfHalves').value = numberOfHalves;

  if (typeof isGoalkeeperSetting === 'string') {
    if ($('isGoalkeeper')) $('isGoalkeeper').checked = (isGoalkeeperSetting === 'true');
    isGoalkeeper = (isGoalkeeperSetting === 'true');
    toggleGoalkeeperButtons();
  }

  // Opponent komt niet uit settings
  currentOpponent = '';
  if ($('setupOpponent')) $('setupOpponent').value = '';

  const scoutings = localStorage.getItem('savedScoutings');
  if (scoutings) { savedScoutings = JSON.parse(scoutings); updateScoutingsList(); }

  updatePlayerInfoCompact();
}

function saveSettings() {
  const halfDuration = $('halfDuration')?.value ?? '10';
  const numberOfHalves = $('numberOfHalves')?.value ?? '2';
  const isGK = $('isGoalkeeper')?.checked || false;

  localStorage.setItem('halfDuration', halfDuration);
  localStorage.setItem('numberOfHalves', numberOfHalves);
  localStorage.setItem('isGoalkeeper', isGK);

  toggleGoalkeeperButtons();
  alert('Settings saved!');
  saveLiveState();

  // Optionele koppeling met scorebord
  const halftimeInput = $('halftimeDuration');  // optioneel extra veld
  const shotInput     = $('shotClockSec');      // optioneel extra veld
  const warnInput     = $('shotWarnSec');       // optioneel extra veld

  const detail = {
    halfMin: parseInt(halfDuration || '10', 10) || 10,
    halftimeMin: halftimeInput ? (parseInt(halftimeInput.value || '3',10)||3) : undefined,
    shotSec: shotInput ? (parseInt(shotInput.value || '60',10)||60) : undefined,
    warnSec: warnInput ? (parseInt(warnInput.value || '20',10)||20) : undefined
  };
  window.dispatchEvent(new CustomEvent('scoreboard:apply-settings', { detail }));
}

// ====== Speeltijd / controls ======
function togglePlaytime() {
  isPlaying = !isPlaying;
  const playtimeBtn = $('playtimeBtn');

  if (isPlaying) {
    if (playtimeBtn){
      playtimeBtn.textContent = "Player is on the field";
      playtimeBtn.classList.remove('not-playing');
      playtimeBtn.classList.add('playing');
    }
    toggleButtons(true);

    clearInterval(playtimeInterval);
    playtimeInterval = setInterval(() => {
      playtime++;
      updatePlaytimeDisplay();
      saveLiveState(); // autosave elke seconde
    }, 1000);
  } else {
    if (playtimeBtn){
      playtimeBtn.textContent = "Player is in the substitution zone";
      playtimeBtn.classList.remove('playing');
      playtimeBtn.classList.add('not-playing');
    }
    toggleButtons(false);
    clearInterval(playtimeInterval);
  }
  saveLiveState();
}

function addMinute(){ playtime += 60; updatePlaytimeDisplay(); saveLiveState(); }
function subtractMinute(){ if (playtime >= 60){ playtime -= 60; updatePlaytimeDisplay(); saveLiveState(); } }

function updatePlaytimeDisplay() {
  const minutes = Math.floor(playtime / 60);
  const seconds = playtime % 60;
  $('playtimeDisplay') && ($('playtimeDisplay').textContent = `${minutes.toString().padStart(2,'0')}:${seconds.toString().padStart(2,'0')}`);
  $('totalPlaytime')   && ($('totalPlaytime').textContent   = `${minutes.toString().padStart(2,'0')}:${seconds.toString().padStart(2,'0')}`);
  updateStats();
}

function increment(counterName) {
  counters[counterName]++;
  updateDisplay(counterName);
  history.push({type: 'increment', counter: counterName});
  updateStats();
  saveLiveState();
}
function decrement(counterName) {
  if (counters[counterName] > 0) {
    counters[counterName]--;
    updateDisplay(counterName);
    history.push({type: 'decrement', counter: counterName});
    updateStats();
    saveLiveState();
  }
}
function updateDisplay(counterName) {
  const el = $(counterName);
  if (el) el.textContent = counters[counterName];
}

function updateStats() {
  const totalPasses = (counters.goodPasses || 0) + (counters.badPasses || 0);
  const passAccuracy = totalPasses > 0 ? Math.round((counters.goodPasses / totalPasses) * 100) : 0;

  const totalShots = getTotalShots(counters);
  const shotAccuracy = totalShots > 0 ? Math.round((counters.goals / totalShots) * 100) : 0;

  const savePct = calcSavePct(counters);
  const minutesPlayed = playtime / 60;
  const involvementValue = involvementPerMinute(counters, minutesPlayed, { passesIncludeAssists: true });

  $('totalPasses')  && ($('totalPasses').textContent  = totalPasses);
  $('passAccuracy') && ($('passAccuracy').textContent = passAccuracy + '%');
  $('shotAccuracy') && ($('shotAccuracy').textContent = shotAccuracy + '%');
  $('involvement')  && ($('involvement').textContent  = involvementValue.toFixed(1));
  $('totalShots')   && ($('totalShots').textContent   = totalShots);

  $('totalInterceptions') && ($('totalInterceptions').textContent = counters.interceptions || 0);
  $('assist')             && ($('assist').textContent             = counters.assists || 0);

  $('goalsAgainstStat')  && ($('goalsAgainstStat').textContent  = counters.goalsAgainst || 0);
  $('goalsDefendedStat') && ($('goalsDefendedStat').textContent = counters.goalsDefended || 0);
  $('goalsAgainst')      && ($('goalsAgainst').textContent      = counters.goalsAgainst || 0);
  $('goalsDefended')     && ($('goalsDefended').textContent     = counters.goalsDefended || 0);

  if ($('keeperSavePct')) $('keeperSavePct').textContent = savePct + '%';
  if ($('savePctText'))   $('savePctText').style.display = isGoalkeeper ? 'block' : 'none';
}

// ====== Tabs ======
function switchTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
  $(tabName)?.classList.add('active');
  document.querySelectorAll('.tab').forEach(tab => {
    if (tab.getAttribute('onclick')?.includes(tabName)) tab.classList.add('active');
  });
  if (tabName === 'stats') {
    updateStats();
    updateScoutingsList();
  }
}

// Subtabs binnen Settings
function switchSettingsTab(name){
  document.querySelectorAll('#settings .subtab').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('#settings .subtab-content').forEach(c=>c.classList.remove('active'));
  if (name === 'general'){
    document.querySelectorAll('#settings .subtab')[0]?.classList.add('active');
    $('settings-general')?.classList.add('active');
  } else {
    document.querySelectorAll('#settings .subtab')[1]?.classList.add('active');
    $('settings-modify')?.classList.add('active');
  }
}

// ====== Auto-save / restore ======
function saveLiveState() {
  const state = {
    counters: { ...counters },
    playtime,
    isPlaying,
    lastTick: Date.now(),
    isGoalkeeper: $('isGoalkeeper')?.checked || false,
    opponent: currentOpponent
  };
  localStorage.setItem(LIVE_STATE_KEY, JSON.stringify(state));
}

function restoreLiveState() {
  const raw = localStorage.getItem(LIVE_STATE_KEY);
  if (!raw) return false;
  try {
    const s = JSON.parse(raw);

    Object.assign(counters, s.counters || {});
    playtime   = Number(s.playtime) || 0;
    isPlaying  = !!s.isPlaying;

    if (typeof s.opponent === 'string') currentOpponent = s.opponent;

    if (isPlaying && s.lastTick) {
      const delta = Math.max(0, Math.floor((Date.now() - s.lastTick) / 1000));
      playtime += delta;
    }

    if (typeof s.isGoalkeeper === 'boolean') {
      const gk = $('isGoalkeeper');
      if (gk) { gk.checked = s.isGoalkeeper; }
      toggleGoalkeeperButtons();
    }

    for (const k in counters) updateDisplay(k);
    updatePlaytimeDisplay();
    updatePlayerInfoCompact();

    if (isPlaying) {
      clearInterval(playtimeInterval);
      playtimeInterval = setInterval(() => {
        playtime++;
        updatePlaytimeDisplay();
        saveLiveState();
      }, 1000);
      const btn = $('playtimeBtn');
      if (btn) {
        btn.textContent = "Player is on the field";
        btn.classList.remove('not-playing');
        btn.classList.add('playing');
      }
      toggleButtons(true);
    }
    return true;
  } catch (e) {
    console.error('restoreLiveState error', e);
    return false;
  }
}

// ====== Lifecycle ======
window.addEventListener('beforeunload', (e) => {
  saveLiveState();
  if (hasProgress()) {
    e.preventDefault();
    e.returnValue = '';
  }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) saveLiveState(); });

// ====== Init ======
window.onload = function() {
  loadSettings();

  const forceSetup = localStorage.getItem(FORCE_SETUP_KEY) === '1';
  const hasProfile =
    !!(localStorage.getItem('playerName') &&
       localStorage.getItem('playerNumber') &&
       localStorage.getItem('ownTeam')); // opponent hoort NIET bij profiel

  let restored = false;
  if (!forceSetup && hasProfile) {
    restored = restoreLiveState();
  }

  if (forceSetup || !hasProfile || !restored) {
    resetAll();
    toggleButtons(false);
    $('setupScreen').style.display = 'block';
    $('mainContent').style.display = 'none';
    localStorage.removeItem(FORCE_SETUP_KEY);
  } else {
    $('setupScreen').style.display = 'none';
    $('mainContent').style.display = 'block';
  }

  $('startScoutingBtn')?.addEventListener('click', saveSetup);
};


/* =======================================================================
   SCOREBOARD MODULE (geïsoleerd) — werkt alleen als DOM aanwezig is
   ======================================================================= */
(function(){
  try {
    const panel = document.getElementById('scorepanel');
    const root  = document.getElementById('tab-scoreboard');
    if (!panel || !root) return;

    const STATE_KEY = 'scoreboardStateV2';
    const CFG_KEY   = 'scoreboardCfgV2';

    // Pak alle elementen 1x
    const el = {
      root,
      homeName: document.getElementById('sb-home-name'),
      awayName: document.getElementById('sb-away-name'),
      homeScore: document.getElementById('sb-home-score'),
      awayScore: document.getElementById('sb-away-score'),
      period: document.getElementById('sb-period'),
      phase: document.getElementById('sb-phase'),
      gameTime: document.getElementById('sb-game-time'),
      gameToggle: document.getElementById('sb-game-toggle'),
      gameReset: document.getElementById('sb-game-reset'),
      nextPhase: document.getElementById('sb-next-phase'),
      shotTime: document.getElementById('sb-shot-time'),
      shotStart: document.getElementById('sb-shot-start'),
      shotReset: document.getElementById('sb-shot-reset'),
      shotCustom: document.getElementById('sb-shot-custom'),
      shotSet: document.getElementById('sb-shot-set'),
      warnAtTxt: document.getElementById('sb-warn-at'),
      newGame: document.getElementById('sb-new-game'),
      fullscreen: document.getElementById('sb-fullscreen'),
      // settings
      settingsOpen: document.getElementById('sb-settings-open'),
      settingsDlg: document.getElementById('sb-settings'),
      settingsClose: document.getElementById('sb-settings-close'),
      cfgHalfMin: document.getElementById('cfg-half-min'),
      cfgHalftimeMin: document.getElementById('cfg-halftime-min'),
      cfgShotSec: document.getElementById('cfg-shot-sec'),
      cfgWarnSec: document.getElementById('cfg-warn-sec'),
      cfgVibrate: document.getElementById('cfg-vibrate'),
      cfgVolume: document.getElementById('cfg-volume'),
      cfgSave: document.getElementById('cfg-save'),
    };

    // DOM guard
    if (!el.homeScore || !el.awayScore || !el.gameToggle || !el.gameTime || !el.shotTime) return;

    // Config + State (persisted)
    const cfg = { halfMin:10, halftimeMin:3, shotSec:60, warnSec:20, vibrate:true, volume:0.6 };
    const state = {
      homeName:'Thuis', awayName:'Uit', homeScore:0, awayScore:0,
      period:1,
      phase:'h1', // start meteen in 1e helft
      gameRemaining: 10*60,
      halftimeRemaining: 3*60,
      gameRunning:false,

      shotRemaining: 60,
      shotRunning:false,
      shotWarnFired:false,
    };

    // Runtime
    let rafId=null, lastTs=null, audioCtx=null, masterGain=null;

    // Helpers
    const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
    const fmtMMSS=(t)=>{t=Math.max(0,Math.round(t));const m=Math.floor(t/60),s=t%60;return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;}
    function save(){ try{ localStorage.setItem(STATE_KEY, JSON.stringify(state)); }catch(e){} }
    function saveCfg(){ try{ localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }catch(e){} }
    function load(){
      try{ Object.assign(cfg, JSON.parse(localStorage.getItem(CFG_KEY)||'{}')); }catch(e){}
      try{ Object.assign(state, JSON.parse(localStorage.getItem(STATE_KEY)||'{}')); }catch(e){}

      // migreer oude 'pre' naar 'h1'
      if (state.phase === 'pre') {
        state.phase = 'h1';
        state.period = 1;
        state.gameRemaining = (cfg.halfMin||10) * 60;
        state.halftimeRemaining = (cfg.halftimeMin||3) * 60;
      }

      if (!(state.shotRemaining > 0)) {
        state.shotRemaining = (cfg.shotSec||60);
      }
    }

    function setupAudio(){
      try{
        if(!audioCtx){
          audioCtx=new (window.AudioContext||window.webkitAudioContext)();
          masterGain=audioCtx.createGain();
          masterGain.connect(audioCtx.destination);
        }
        masterGain.gain.value = clamp(cfg.volume,0,1);
      }catch(e){}
    }
    function beep(freq=600, ms=500){
      try{
        setupAudio();
        const o=audioCtx.createOscillator(), g=audioCtx.createGain();
        o.type='square'; o.frequency.value=freq; o.connect(g); g.connect(masterGain);
        const now = audioCtx.currentTime;
        g.gain.setValueAtTime(0.0001,now);
        g.gain.exponentialRampToValueAtTime(0.5, now+0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now+ms/1000);
        o.start(now); o.stop(now+ms/1000);
      }catch(e){}
    }
    function vib(pattern){ if(!cfg.vibrate) return; try{ navigator.vibrate?.(pattern); }catch(e){} }

    // WebAudio-geschedulde patronen (robuust op mobiel)
    function beepPattern(times=3, freq=800, toneMs=250, gapMs=120){
      try{
        setupAudio();
        const toneSec = toneMs / 1000;
        const gapSec  = gapMs  / 1000;
        let t = audioCtx.currentTime;

        for (let i=0; i<times; i++){
          const o = audioCtx.createOscillator();
          const g = audioCtx.createGain();
          o.type = 'square';
          o.frequency.value = freq;
          o.connect(g); g.connect(masterGain);

          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t + toneSec);

          o.start(t);
          o.stop(t + toneSec);

          t += toneSec + gapSec;
        }
      }catch(e){}
    }
    function vibPattern(times=3, onMs=200, gapMs=120){
      if (!cfg.vibrate) return;
      const pattern = [];
      for (let i=0; i<times; i++){
        pattern.push(onMs);
        if (i < times-1) pattern.push(gapMs);
      }
      vib(pattern);
    }

    function render(){
      el.homeName && (el.homeName.value=state.homeName);
      el.awayName && (el.awayName.value=state.awayName);
      el.homeScore.textContent=state.homeScore;
      el.awayScore.textContent=state.awayScore;
      el.period && (el.period.textContent=state.period);
      if (el.phase) el.phase.textContent=({pre:'Vooraf',h1:'1e helft',halftime:'Rust',h2:'2e helft',end:'Einde'})[state.phase]||'–';
      el.gameTime.textContent=fmtMMSS(state.phase==='halftime'?state.halftimeRemaining:state.gameRemaining);
      el.shotTime.textContent=Math.max(0, Math.ceil(state.shotRemaining));
      el.warnAtTxt && (el.warnAtTxt.textContent=cfg.warnSec);
      el.gameToggle.textContent=state.gameRunning?'Pauze (Spatie)':'Start (Spatie)';
      if (el.shotStart){ el.shotStart.textContent=state.shotRunning?'Pauze (S)':'Start (S)'; el.shotStart.disabled=!state.gameRunning; }
    }

    function resetShot(toSec = cfg.shotSec){
      state.shotRemaining = clamp(Number(toSec)||cfg.shotSec, 1, 999);
      state.shotWarnFired = false;
      // start meteen mee als de wedstrijd loopt
      state.shotRunning = !!state.gameRunning;
      save(); render(); ensureTick();
    }

    function toggleShot(){ if(!state.gameRunning) return; state.shotRunning=!state.shotRunning; save(); render(); ensureTick(); }

    function resetGamePeriod(){
      if(state.phase==='halftime'){ state.halftimeRemaining=cfg.halftimeMin*60; }
      else { state.gameRemaining=cfg.halfMin*60; }
      state.gameRunning=false; state.shotRunning=false; save(); render();
    }

    function nextPhase(){
      if(state.phase==='pre'){
        state.phase='h1'; state.period=1;
        state.gameRemaining=cfg.halfMin*60; state.halftimeRemaining=cfg.halftimeMin*60;
        resetShot(cfg.shotSec);
      } else if(state.phase==='h1'){
        state.phase='halftime'; state.gameRunning=false; state.shotRunning=false;
      } else if(state.phase==='halftime'){
        state.phase='h2'; state.period=2; state.gameRemaining=cfg.halfMin*60; resetShot(cfg.shotSec);
      } else if(state.phase==='h2'){
        state.phase='end'; state.gameRunning=false; state.shotRunning=false;
      }
      save(); render();
    }

    function newGame(){
      if(!confirm('Nieuwe wedstrijd starten? Alle tellers en tijden worden gereset.')) return;
      state.homeScore=0; state.awayScore=0; state.period=1; state.phase='h1';
      state.gameRunning=false; state.shotRunning=false;
      state.gameRemaining=cfg.halfMin*60; state.halftimeRemaining=cfg.halftimeMin*60;
      resetShot(cfg.shotSec); save(); render();
    }

    function toggleGame(){
      const starting = !state.gameRunning;
      state.gameRunning = starting;

      if (starting) {
        if (state.phase === 'pre') {
          state.phase = 'h1';
          state.period = 1;
          if (!(state.gameRemaining > 0)) state.gameRemaining = cfg.halfMin * 60;
        }
        // shotklok herstart automatisch
        if (state.shotRemaining <= 0) {
          state.shotRemaining = cfg.shotSec;
        }
        state.shotRunning = true;
      } else {
        state.shotRunning = false; // pauze
      }

      save(); render(); ensureTick();
    }

    function ensureTick(){ if(rafId==null && (state.gameRunning||state.shotRunning)) { lastTs=null; rafId=requestAnimationFrame(tick); } }
    function cancelTick(){ if(rafId){ cancelAnimationFrame(rafId); rafId=null; } lastTs=null; }

    function tick(ts){
      if(!state.gameRunning && !state.shotRunning){ cancelTick(); return; }
      if(lastTs==null) lastTs=ts;
      const dt=(ts-lastTs)/1000; lastTs=ts;

      // GAME TIMER
      if(state.gameRunning){
        if(state.phase==='halftime'){
          state.halftimeRemaining-=dt;
          if(state.halftimeRemaining<=0){
            state.halftimeRemaining=0; state.gameRunning=false;
            beep(520,700); vib([200,120,200]);
            // Auto naar 2e helft
            state.phase='h2'; state.period=2; state.gameRemaining=cfg.halfMin*60; resetShot(cfg.shotSec);
          }
        } else if(state.phase==='h1' || state.phase==='h2'){
          state.gameRemaining-=dt;
          if(state.gameRemaining<=0){
            state.gameRemaining=0; state.gameRunning=false; beep(520,700); vib([200,120,200]);
            if(state.phase==='h1'){ state.phase='halftime'; } else if(state.phase==='h2'){ state.phase='end'; }
            state.shotRunning=false;
          }
        }
      }

      // SHOT CLOCK — echte decrement
      if (state.shotRunning) {
        state.shotRemaining -= dt;
      }

      // Waarschuwing bij 20s (of cfg.warnSec) – één keer
      if (!state.shotWarnFired && state.shotRemaining <= cfg.warnSec && state.shotRemaining > 0){
        state.shotWarnFired = true;
        beepPattern(3, 800, 250, 120);
        vibPattern(3, 200, 120);
      }

      // Eindsignaal bij 0s
      if (state.shotRemaining <= 0){
        state.shotRemaining = 0;
        state.shotRunning = false;
        beepPattern(5, 680, 600, 120);
        vibPattern(5, 200, 120);
      }

      el.gameTime.textContent = fmtMMSS(state.phase==='halftime'?state.halftimeRemaining:state.gameRemaining);
      el.shotTime.textContent = Math.max(0, Math.ceil(state.shotRemaining));
      rafId=requestAnimationFrame(tick);
    }

    function toggleFullscreen(){ const r=el.root; if(!document.fullscreenElement){ r.requestFullscreen?.(); } else { document.exitFullscreen?.(); } }

    // Events
    function onClick(e){
      const t=e.target.closest('button'); if(!t) return;
      const team=t.getAttribute('data-score');
      if(team){
        const delta=Number(t.getAttribute('data-delta')||0);
        if(team==='home') state.homeScore=Math.max(0,state.homeScore+delta);
        else state.awayScore=Math.max(0,state.awayScore+delta);
        save(); render(); return;
      }
      if(t===el.gameToggle) return toggleGame();
      if(t===el.gameReset)  return resetGamePeriod();
      if(t===el.nextPhase)  return nextPhase();

      if(t===el.shotStart)  return toggleShot();
      if(t===el.shotReset)  return resetShot(cfg.shotSec);
      if(t===el.shotSet)    return resetShot(Number(el.shotCustom?.value||cfg.shotSec));

      if(t===el.newGame)    return newGame();
      if(t===el.fullscreen) return toggleFullscreen();

      if(t.id==='sb-settings-open'){ openSettings(); return; }
    }
    function onInput(e){
      if(e.target===el.homeName){ state.homeName = el.homeName.value.trim()||'Thuis'; save(); }
      if(e.target===el.awayName){ state.awayName = el.awayName.value.trim()||'Uit';  save(); }
    }
    function onKey(e){
      const ae=document.activeElement; const typing = ae && (ae.tagName==='INPUT' || ae.isContentEditable);
      if(typing) return;
      if(e.code==='Space'){ e.preventDefault(); toggleGame(); }
      else if(e.key==='s'||e.key==='S'){ toggleShot(); }
      else if(e.key==='r'||e.key==='R'){ resetShot(cfg.shotSec); }
      else if(e.key==='n'||e.key==='N'){ nextPhase(); }
      else if(e.key==='h'||e.key==='H'){ if(e.shiftKey) state.homeScore=Math.max(0,state.homeScore-1); else state.homeScore+=1; save(); render(); }
      else if(e.key==='a'||e.key==='A'){ if(e.shiftKey) state.awayScore=Math.max(0,state.awayScore-1); else state.awayScore+=1; save(); render(); }
    }

    // Settings modal
    function openSettings(){
      if(!el.settingsDlg) return;
      el.cfgHalfMin.value=cfg.halfMin; el.cfgHalftimeMin.value=cfg.halftimeMin;
      el.cfgShotSec.value=cfg.shotSec; el.cfgWarnSec.value=cfg.warnSec;
      el.cfgVibrate.checked=!!cfg.vibrate; el.cfgVolume.value=Math.round(cfg.volume*100);
      el.settingsDlg.showModal?.();
    }
    function applySettings(){
      cfg.halfMin = clamp(parseInt(el.cfgHalfMin.value||10,10),1,60);
      cfg.halftimeMin = clamp(parseInt(el.cfgHalftimeMin.value||3,10),0,30);
      cfg.shotSec = clamp(parseInt(el.cfgShotSec.value||60,10),1,999);
      cfg.warnSec = clamp(parseInt(el.cfgWarnSec.value||20,10),1,998);
      cfg.vibrate = !!el.cfgVibrate.checked;
      cfg.volume = clamp((parseInt(el.cfgVolume.value||60,10))/100,0,1);
      saveCfg();
      if(!state.gameRunning){
        state.gameRemaining = cfg.halfMin*60;
        state.halftimeRemaining = cfg.halftimeMin*60;
      }
      resetShot(cfg.shotSec);
      render();
    }

    // Init & wiring
    load(); render();
    el.root.addEventListener('click', onClick);
    el.root.addEventListener('input', onInput);
    window.addEventListener('keydown', onKey);
    el.cfgSave?.addEventListener('click', (e)=>{ e.preventDefault(); applySettings(); el.settingsDlg?.close?.(); });
    el.settingsClose?.addEventListener('click', (e)=>{ e.preventDefault(); el.settingsDlg?.close?.(); });

    // Pauzeer timers wanneer scorepanel-tab niet actief is
    const visObs = new MutationObserver(()=>{
      const active = panel.classList.contains('active');
      if(!active) cancelTick(); else ensureTick();
    });
    visObs.observe(panel, { attributes:true, attributeFilter:['class'] });

    // Koppeling met "General" settings-tab (optioneel event vanuit saveSettings)
    window.addEventListener('scoreboard:apply-settings', (ev)=>{
      const d = ev.detail || {};
      if (typeof d.halfMin === 'number' && d.halfMin > 0) cfg.halfMin = d.halfMin;
      if (typeof d.halftimeMin === 'number' && d.halftimeMin >= 0) cfg.halftimeMin = d.halftimeMin;
      if (typeof d.shotSec === 'number' && d.shotSec > 0) cfg.shotSec = d.shotSec;
      if (typeof d.warnSec === 'number' && d.warnSec > 0) cfg.warnSec = d.warnSec;
      saveCfg();
      if(!state.gameRunning){
        state.gameRemaining = cfg.halfMin*60;
        state.halftimeRemaining = cfg.halftimeMin*60;
      }
      resetShot(cfg.shotSec);
      render();
    });
  } catch(err){
    console.error('Scoreboard module init failed:', err);
  }
})();

/* =======================================================================
   EXPOSE FUNCTIES VOOR INLINE onclick IN HTML
   ======================================================================= */
window.saveSetup = saveSetup;
window.showSetupScreen = showSetupScreen;
window.resetAndShowSetup = resetAndShowSetup;
window.savePlayerFromModify = savePlayerFromModify;
window.toggleGoalkeeperButtons = toggleGoalkeeperButtons;
window.switchTab = switchTab;
window.switchSettingsTab = switchSettingsTab;
window.endGame = endGame;
window.addMinute = addMinute;
window.subtractMinute = subtractMinute;
window.togglePlaytime = togglePlaytime;
window.increment = increment;
window.decrement = decrement;
