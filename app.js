// ===== Service worker registreren =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(console.error);
  });
}

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

const history = [];
let playtime = 0; // in seconden
let playtimeInterval = null;
let isPlaying = false;
let savedScoutings = [];
let isGoalkeeper = false;

// ====== HELPERS ======
function $(id){ return document.getElementById(id); }

// Kleine util: heeft er “voortgang” plaatsgevonden?
function hasProgress(){
  if (playtime > 0) return true;
  for (const k in counters){ if (counters[k] > 0) return true; }
  return false;
}

// ====== UI ======
function updatePlayerInfoCompact() {
  const playerName = $('playerName')?.value || '';
  const playerNumber = $('playerNumber')?.value || '';
  const ownTeam = $('ownTeam')?.value || '';
  const opponent = $('opponent')?.value || '';

  let infoText = "";
  if (playerName) {
    infoText += `${playerName}`;
    if (playerNumber) infoText += ` (#${playerNumber})`;
  }
  if (ownTeam) {
    if (infoText) infoText += " | ";
    infoText += `${ownTeam}`;
  }
  if (opponent) {
    if (infoText) infoText += " vs ";
    infoText += `${opponent}`;
  }
  $('playerInfoCompact').textContent = infoText || "No player information";
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
  $('setupScreen').style.display = 'block';
  $('mainContent').style.display = 'none';

  // Prefill vanuit Modify-tab
  $('setupPlayerName').value   = $('playerName')?.value || '';
  $('setupPlayerNumber').value = $('playerNumber')?.value || '';
  $('setupOwnTeam').value      = $('ownTeam')?.value || '';
  $('setupOpponent').value     = $('opponent')?.value || '';
  $('setupIsGoalkeeper').checked = $('isGoalkeeper')?.checked || false;
}

function saveSetup() {
  const playerName   = $('setupPlayerName').value.trim();
  const playerNumber = $('setupPlayerNumber').value.trim();
  const ownTeam      = $('setupOwnTeam').value.trim();
  const opponent     = $('setupOpponent').value.trim();
  const isGK         = $('setupIsGoalkeeper').checked;

  if (!playerName || !playerNumber || !ownTeam || !opponent) {
    alert("Fill in all fields to start scouting!");
    return;
  }

  // Schrijf naar Modify-tab velden
  $('playerName').value   = playerName;
  $('playerNumber').value = playerNumber;
  $('ownTeam').value      = ownTeam;
  $('opponent').value     = opponent;
  $('isGoalkeeper').checked = isGK;

  // Persist
  localStorage.setItem('playerName', playerName);
  localStorage.setItem('playerNumber', playerNumber);
  localStorage.setItem('ownTeam', ownTeam);
  localStorage.setItem('opponent', opponent);
  localStorage.setItem('isGoalkeeper', isGK);

  updatePlayerInfoCompact();
  toggleGoalkeeperButtons();

  $('setupScreen').style.display = 'none';
  $('mainContent').style.display = 'block';

  saveLiveState();
}

// Handige knop in Settings → General
// --- PATCH: vervang/bewerk deze functie ---
function resetAndShowSetup(){
  try {
    // Stop timer netjes
    if (isPlaying) {
      isPlaying = false;
      if (playtimeInterval) {
        clearInterval(playtimeInterval);
        playtimeInterval = null;
      }
    }

    // Zet play-knop terug naar "wisselzone"
    const playtimeBtn = document.getElementById('playtimeBtn');
    if (playtimeBtn) {
      playtimeBtn.textContent = "Player is in the substitution zone";
      playtimeBtn.classList.remove('playing');
      playtimeBtn.classList.add('not-playing');
    }

    // Reset counters & tijd en UI
    if (typeof resetAll === 'function') {
      resetAll();               // zet counters op 0 + display bijwerken
    } else {
      // minimale fallback
      playtime = 0;
      if (typeof updatePlaytimeDisplay === 'function') updatePlaytimeDisplay();
    }
    toggleButtons(false);

    // Wis live state zodat onLoad niet terug springt naar mainContent
    localStorage.removeItem(LIVE_STATE_KEY);

    // Toon startscherm, verberg main
    const setup = document.getElementById('setupScreen');
    const main  = document.getElementById('mainContent');
    if (setup) setup.style.display = 'block';
    if (main)  main.style.display  = 'none';

    // (optioneel) Naar boven scrollen voor zekerheid
    window.scrollTo({ top: 0, behavior: 'instant' });
  } catch (e) {
    console.error('resetAndShowSetup error', e);
  }
}

// --- BELANGRIJK: zorg dat de functie globaal is voor onclick=... ---
window.resetAndShowSetup = resetAndShowSetup;


// ====== Modify-tab acties ======
function savePlayerFromModify(){
  const playerName   = $('playerName').value.trim();
  const playerNumber = $('playerNumber').value.trim();
  const ownTeam      = $('ownTeam').value.trim();
  const opponent     = $('opponent').value.trim();
  const isGK         = $('isGoalkeeper').checked;

  localStorage.setItem('playerName', playerName);
  localStorage.setItem('playerNumber', playerNumber);
  localStorage.setItem('ownTeam', ownTeam);
  localStorage.setItem('opponent', opponent);
  localStorage.setItem('isGoalkeeper', isGK);

  updatePlayerInfoCompact();
  toggleGoalkeeperButtons();
  alert('Player saved!');
  saveLiveState();
}

// ====== Einde wedstrijd ======
// --- PATCH: stop klok eerst, dan opslaan ---
function endGame() {
  // 1) Stop de effectieve speeltijd meteen als die loopt
  if (isPlaying) {
    togglePlaytime(); // stopt interval, zet knop naar "substitution zone", disabled knoppen, saveLiveState()
  }

  const playerName   = $('playerName')?.value || '';
  const playerNumber = $('playerNumber')?.value || '';
  const ownTeam      = $('ownTeam')?.value || '';
  const opponent     = $('opponent')?.value || '';

  if (!playerName) { alert("Please enter the player's name!"); return; }

  // (optioneel) 2) Sync de UI nog 1 keer
  updatePlaytimeDisplay();

  // 3) Statistieken berekenen met de definitief gestopte tijd
  const totalPasses = (counters.goodPasses || 0) + (counters.badPasses || 0);
  const passAccuracy = totalPasses > 0 ? Math.round((counters.goodPasses / totalPasses) * 100) : 0;

  const totalShots = getTotalShots(counters);
  const shotAccuracy = totalShots > 0 ? Math.round((counters.goals / totalShots) * 100) : 0;

  const savePct = calcSavePct(counters);
  const minutesPlayed = playtime / 60;
  const involvement = minutesPlayed > 0
    ? involvementPerMinute(counters, minutesPlayed, { passesIncludeAssists: true }) : 0.0;

  const scouting = {
    id: Date.now(),
    date: new Date().toLocaleString('nl-NL'),
    playerName, playerNumber, ownTeam, opponent,
    playtime, isGoalkeeper,
    stats: { ...counters },
    totals: { totalPasses, passAccuracy, shotAccuracy, involvement, savePct }
  };

  savedScoutings.push(scouting);
  localStorage.setItem('savedScoutings', JSON.stringify(savedScoutings));

  updateScoutingsList();
  alert(`Game of ${playerName} is saved!`);

  // 4) Reset na bewaren
  resetAll();
  localStorage.removeItem(LIVE_STATE_KEY);
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
  const opponent = localStorage.getItem('opponent') || '';
  const halfDuration = localStorage.getItem('halfDuration') || '';
  const numberOfHalves = localStorage.getItem('numberOfHalves') || '';
  const isGoalkeeperSetting = localStorage.getItem('isGoalkeeper');

  if ($('playerName'))   $('playerName').value   = playerName;
  if ($('playerNumber')) $('playerNumber').value = playerNumber;
  if ($('ownTeam'))      $('ownTeam').value      = ownTeam;
  if ($('opponent'))     $('opponent').value     = opponent;

  if (halfDuration && $('halfDuration')) $('halfDuration').value = halfDuration;
  if (numberOfHalves && $('numberOfHalves')) $('numberOfHalves').value = numberOfHalves;

  if (typeof isGoalkeeperSetting === 'string'){
    if ($('isGoalkeeper')) $('isGoalkeeper').checked = (isGoalkeeperSetting === 'true');
    isGoalkeeper = (isGoalkeeperSetting === 'true');
    toggleGoalkeeperButtons();
  }

  const scoutings = localStorage.getItem('savedScoutings');
  if (scoutings) { savedScoutings = JSON.parse(scoutings); updateScoutingsList(); }

  updatePlayerInfoCompact();
}

function saveSettings() {
  const halfDuration = $('halfDuration').value;
  const numberOfHalves = $('numberOfHalves').value;
  const isGK = $('isGoalkeeper')?.checked || false;

  localStorage.setItem('halfDuration', halfDuration);
  localStorage.setItem('numberOfHalves', numberOfHalves);
  localStorage.setItem('isGoalkeeper', isGK);

  toggleGoalkeeperButtons();
  alert('Settings saved!');
  saveLiveState();
}

// ====== Speeltijd / controls ======
function togglePlaytime() {
  isPlaying = !isPlaying;
  const playtimeBtn = $('playtimeBtn');

  if (isPlaying) {
    playtimeBtn.textContent = "Player is on the field";
    playtimeBtn.classList.remove('not-playing');
    playtimeBtn.classList.add('playing');
    toggleButtons(true);

    clearInterval(playtimeInterval);
    playtimeInterval = setInterval(() => {
      playtime++;
      updatePlaytimeDisplay();
      saveLiveState(); // autosave elke seconde
    }, 1000);
  } else {
    playtimeBtn.textContent = "Player is in the substitution zone";
    playtimeBtn.classList.remove('playing');
    playtimeBtn.classList.add('not-playing');
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
  $('playtimeDisplay').textContent = `${minutes.toString().padStart(2,'0')}:${seconds.toString().padStart(2,'0')}`;
  $('totalPlaytime').textContent   = `${minutes.toString().padStart(2,'0')}:${seconds.toString().padStart(2,'0')}`;
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

  if ($('goalsAgainstStat'))   $('goalsAgainstStat').textContent   = counters.goalsAgainst || 0;
  if ($('goalsDefendedStat'))  $('goalsDefendedStat').textContent  = counters.goalsDefended || 0;
  if ($('goalsAgainst'))       $('goalsAgainst').textContent       = counters.goalsAgainst || 0;
  if ($('goalsDefended'))      $('goalsDefended').textContent      = counters.goalsDefended || 0;

  if ($('keeperSavePct')) $('keeperSavePct').textContent = savePct + '%';
  if ($('savePctText'))   $('savePctText').style.display = isGoalkeeper ? 'block' : 'none';
}

// ====== Tabs ======
function switchTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
  $(tabName).classList.add('active');
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
    document.querySelectorAll('#settings .subtab')[0].classList.add('active');
    $('settings-general').classList.add('active');
  } else {
    document.querySelectorAll('#settings .subtab')[1].classList.add('active');
    $('settings-modify').classList.add('active');
  }
}

// ====== Auto-save / restore ======
function saveLiveState() {
  const state = {
    counters: { ...counters },
    playtime,
    isPlaying,
    lastTick: Date.now(),
    isGoalkeeper: $('isGoalkeeper')?.checked || false
  };
  localStorage.setItem(LIVE_STATE_KEY, JSON.stringify(state));
}

/** @returns {boolean} true als er state is hersteld */
function restoreLiveState() {
  const raw = localStorage.getItem(LIVE_STATE_KEY);
  if (!raw) return false;
  try {
    const s = JSON.parse(raw);

    Object.assign(counters, s.counters || {});
    playtime   = Number(s.playtime) || 0;
    isPlaying  = !!s.isPlaying;

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

// Verlaat/achtergrond
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
  const restored = restoreLiveState();

  // Startscherm altijd bereikbaar: als niets te herstellen, toon startscherm
  if (!restored) {
    updatePlaytimeDisplay();
    updateStats();
    $('setupScreen').style.display = 'block';
    $('mainContent').style.display = 'none';
    toggleButtons(false);
  } else {
    // Herstel vorige sessie
    $('setupScreen').style.display = 'none';
    $('mainContent').style.display = 'block';
  }
};

// ====== Expose voor onclick ======
window.saveSetup = saveSetup;
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
