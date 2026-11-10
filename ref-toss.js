/* The players set the match up themselves, shared by both referee layouts. The referee
   stands at the side of the court and turns the phone out to them: one presses their
   name and calls the coin, then the teams make their picks as USAP 5.A has it. The
   winner picks serve, receive or an end, or defers. The other team takes what's left
   of that pair, and deferring hands them the first pick. Then the phone goes back to
   the referee, on the usual setup screen with everything filled in. The stream shows
   each step as it happens, and moves on to the player cards at that handover.

   Ref setup skips all this. The choice is kept on this phone. */
const TOSS_BY_REF_KEY = 'ref.setup.byRef';
let tossing = null; // { step, caller, name, call, result, chooser, deferred, picks, end, right }

function setupByRef() {
  return localStorage.getItem(TOSS_BY_REF_KEY) === '1';
}

/* A match not started yet. A toss already recorded isn't tossed again. Everything else
   starts with calling the players: opening a match to look at it doesn't call anybody. */
function beginSetup(m) {
  setup = defaultSetup(m);
  if (m.toss) {
    tossServes(m.toss.serving_team);
    return;
  }
  tossing = { step: 'summon', called: false, callFailed: false, here: [], changing: 0 };
  renderToss();
  watchArrivals();
}

/* Puts "Come to Court" up on the court's monitor and the stream. Calling again is the same
   press: people who didn't come the first time. */
async function callPlayers() {
  const calling = tossing;
  try {
    await api('POST', `/tournaments/${TOURNAMENT}/referee/matches/${match.match_id}/opened`);
    calling.called = true;
    calling.callFailed = false;
  } catch {
    calling.callFailed = true;
  }
  if (tossing === calling) renderToss();
}

/* Who has signed in, on the court's monitor or on this phone: either one counts. When
   everybody has, the toss comes up by itself. */
const tossArrivalsPath = () =>
  `/tournaments/${TOURNAMENT}/referee/matches/${match.match_id}/arrivals`;

function arrivalsChanged(here) {
  if (tossing?.step !== 'summon') return;
  const before = JSON.stringify([...tossing.here].sort());
  tossing.here = here;
  if (here.length) tossing.called = true;
  const players = [1, 2].flatMap((team) => playersOf(team) || []);
  if (players.length && players.every((player) => here.includes(player.id))) {
    playersHere();
  } else if (before !== JSON.stringify([...here].sort())) {
    renderToss();
  }
}

function watchArrivals() {
  const watching = tossing;
  const look = async () => {
    if (tossing !== watching) {
      clearInterval(timer);
      return;
    }
    if (watching.changing) return;
    try {
      const { data } = await api('GET', tossArrivalsPath());
      // Something may have been ticked while that was on its way.
      if (tossing === watching && !watching.changing) arrivalsChanged(data);
    } catch {
      // Keeps what this phone knows. Ticking here still works without it.
    }
  };
  const timer = setInterval(look, 1000);
  look();
}

async function tickPlayer(id) {
  const ticking = tossing;
  const here = !ticking.here.includes(id);
  ticking.changing += 1;
  const sending = api('PUT', tossArrivalsPath(), { player_id: id, here }).catch(() => {});
  arrivalsChanged(here ? [...ticking.here, id] : ticking.here.filter((row) => row !== id));
  await sending;
  ticking.changing -= 1;
}

function arrivalNames(team) {
  return (playersOf(team) || [])
    .map((player) => {
      const here = tossing.here.includes(player.id);
      return `<button class="tossbig ${here ? 'here' : ''}" onclick="tickPlayer(${player.id})">${here ? '✓ ' : ''}${esc(player.name)}</button>`;
    })
    .join('');
}

/* With the players here, or already standing there, so never called. */
function playersHere() {
  if (setupByRef()) {
    closeToss();
    render();
  } else {
    openToss();
  }
}

function tossServes(team) {
  if (team !== setup.servingTeam) swapServingTeam();
}

function openToss() {
  localStorage.removeItem(TOSS_BY_REF_KEY);
  tossing = { step: 'call', picks: [], made: [], starters: [], right: {}, events: [] };
  tossShowLive(null);
  renderToss();
}

function closeToss() {
  tossing = null;
  document.getElementById('tossPage')?.remove();
}

function tossToRef() {
  localStorage.setItem(TOSS_BY_REF_KEY, '1');
  tossShowLive(null);
  closeToss();
  render();
}

function tossBack() {
  tossShowLive(null);
  closeToss();
  backToCourt();
}

/* Tells the stream each step as it's taken, in order. Only a graphic hangs on it, so
   it's fine to miss: the record of the toss is sent on its own at the end. */
let tossSending = Promise.resolve();
function tossShowLive(toss) {
  const path = `/tournaments/${TOURNAMENT}/referee/matches/${match.match_id}/toss_live`;
  tossSending = tossSending.then(() => api('PUT', path, { toss })).catch(() => {});
}

function tossLiveNow() {
  tossShowLive({
    caller_team: tossing.caller,
    caller_name: tossing.name,
    call: tossing.call ?? null,
    result: tossing.landed ? tossing.result : null,
    picks: tossing.made,
    starters: tossing.starters,
    latest: tossing.latest ?? null,
    events: tossing.events,
  });
}

function tossTeam(team) {
  return team === 1 ? match.team1 : match.team2;
}
const tossOther = (team) => (team === 1 ? 2 : 1);

function tossCaller(team, name) {
  Object.assign(tossing, { step: 'face', caller: team, name });
  tossing.events.push({ caller: name, call: null });
  tossLiveNow();
  renderToss();
}

function tossCall(call) {
  const bit = crypto.getRandomValues(new Uint8Array(1))[0] & 1;
  Object.assign(tossing, { step: 'flip', call, result: bit ? 'HEADS' : 'TAILS' });
  tossing.events.at(-1).call = call;
  tossLiveNow();
  renderToss();
  const flipping = tossing;
  setTimeout(() => {
    if (tossing !== flipping) return;
    tossing.step = 'won';
    tossing.landed = true;
    tossing.chooser = tossWinner();
    // Only once it's landed: the summary mustn't give the flip away.
    tossing.events.push({ won: tossWinner(), result: tossing.result });
    tossLiveNow();
    renderToss();
  }, 2500);
}

function tossWinner() {
  return tossing.call === tossing.result ? tossing.caller : tossOther(tossing.caller);
}

function tossChoose() {
  tossing.step = 'choose';
  renderToss();
}

function tossPick(choice) {
  // An end goes up on the stream once they've said which one.
  if (choice !== 'SIDE') tossMade({ team: tossing.chooser, choice });
  if (choice === 'DEFER') {
    tossing.deferred = true;
    tossing.chooser = tossOther(tossing.chooser);
  } else {
    tossing.picks.push({ team: tossing.chooser, choice });
    if (choice === 'SIDE') tossing.step = 'end';
    else tossNext();
  }
  renderToss();
}

function tossMade(pick) {
  tossing.made.push(pick);
  tossing.events.push(pick);
  tossing.latest = 'PICK';
  tossLiveNow();
}

function tossEnd(side) {
  tossing.end = { team: tossing.chooser, side };
  tossMade({ team: tossing.chooser, choice: 'SIDE', end: side });
  tossNext();
  renderToss();
}

/* Whoever takes serve or receive says straight away who's on the right. Then the end
   gets picked if it hasn't been, and the other team says who's on their right last. */
function tossNext() {
  const decided = tossing.picks.find((pick) => pick.choice !== 'SIDE');
  if (decided && tossNeedsRight(decided.team)) return tossAskRight(decided.team);
  if (tossing.picks.length < 2) {
    tossing.chooser = tossOther(tossing.picks.at(-1).team);
    // Only one thing is left of the pair, so only ask for what they can still take.
    tossing.step = 'choose';
    return;
  }
  const other = tossOther(decided.team);
  if (tossNeedsRight(other)) return tossAskRight(other);
  tossing.step = 'back';
}

// A team without two players entered has nobody to choose between.
function tossNeedsRight(team) {
  return tossing.right[team] == null && (playersOf(team) || []).length >= 2;
}

function tossAskRight(team) {
  tossing.step = 'right';
  tossing.rightTeam = team;
}

function tossServing() {
  const { team, choice } = tossing.picks.find((pick) => pick.choice !== 'SIDE');
  return choice === 'SERVE' ? team : tossOther(team);
}

function tossRight(id) {
  const team = tossing.rightTeam;
  tossing.right[team] = id;
  const starter = { team, name: playersOf(team).find((player) => player.id === id).name };
  tossing.starters.push(starter);
  tossing.events.push(starter);
  tossing.latest = 'STARTER';
  tossLiveNow();
  tossNext();
  renderToss();
}

function sendToss() {
  const [first, second] = tossing.picks.map((pick) => pick.choice);
  const body = {
    caller_team: tossing.caller,
    call: tossing.call,
    result: tossing.result,
    flipped_in_app: true,
    winner_choice: tossing.deferred ? 'DEFER' : first,
    loser_choice: tossing.deferred ? first : second,
    winner_second_choice: tossing.deferred ? second : null,
  };
  match.toss = { winner_team: tossWinner(), serving_team: tossServing() };
  const path = `/tournaments/${TOURNAMENT}/referee/matches/${match.match_id}/toss`;
  // Only the toss that counted: a match keeps one flip, and Start again tosses another.
  const flipPath = path.replace(/toss$/, 'coin_flip');
  const flip = { result: tossing.result };
  // After the last step, so the stream moves on from the toss and doesn't go back to it.
  tossSending = tossSending
    .then(() => api('PUT', flipPath, flip).catch(() => {}))
    .then(() => api('PUT', path, body))
    .catch(() => queue({ path, body }));
}

/* Back to the referee, at the side of the court. It's drawn side by side, each team
   at its real end, with the main entrance's end on whichever side of the referee they
   said it is (on their right unless they changed it). */
function tossHandBack() {
  sendToss();
  const serves = tossServing();
  tossServes(serves);
  const receives = tossOther(serves);
  if (tossing.right[serves] != null) setup.serverAnchorId = tossing.right[serves];
  if (tossing.right[receives] != null) setup.receiverAnchorId = tossing.right[receives];
  const { team, side } = tossing.end;
  const leftEnd = entranceRight ? 'BACK' : 'FRONT';
  const team1OnRefsLeft = (team === 1) === (side === leftEnd);
  layout = 'side';
  flipped = !team1OnRefsLeft;
  localStorage.setItem('ref.layout', layout);
  localStorage.setItem('ref.flip', flipped ? '1' : '0');
  closeToss();
  render();
}

/* What's been decided so far, in the order it was. A team's serve or receive turns into the
   player's name, where it is, once they've said who starts. */
function tossSummary() {
  const events = tossing.events ?? [];
  if (!events.length) return '';
  const decided = events.find((row) => row.choice === 'SERVE' || row.choice === 'RECEIVE');
  const starterOf = (team) => events.find((row) => row.name && row.team === team);
  const role = (team, one) => {
    const serves = team === tossServing();
    return `${serves ? 'serve' : 'receive'}${one ? 's' : ''} first`;
  };
  const line = (who, what) => `<p class="tossline"><b>${esc(who)}</b> ${what}</p>`;
  const lines = events.map((row) => {
    if (row.caller) {
      return line(row.caller, row.call ? `called ${row.call.toLowerCase()}` : 'is doing the toss');
    }
    if (row.won) {
      return line(tossTeam(row.won), `won the toss on ${row.result.toLowerCase()}`);
    }
    if (row.name) {
      return row.team === decided.team ? '' : line(row.name, role(row.team, true));
    }
    const team = tossTeam(row.team);
    if (row.choice === 'DEFER') return line(team, 'deferred');
    if (row.choice === 'SIDE') {
      return line(team, `picked the ${row.end === 'FRONT' ? 'main' : 'second'} entrance end`);
    }
    const starter = starterOf(row.team);
    return starter ? line(starter.name, role(row.team, true)) : line(team, role(row.team, false));
  });
  // A team without two players never says who starts, so it's only known at the end.
  if (tossing.step === 'back' && !starterOf(tossOther(decided.team))) {
    const other = tossOther(decided.team);
    lines.push(line(tossTeam(other), role(other, false)));
  }
  return `<div class="tosslog">${lines.join('')}</div>`;
}

function tossNames(team, action) {
  const players = playersOf(team) || [];
  if (!players.length) {
    return `<button class="tossbig" onclick="${action(null, tossTeam(team))}">${esc(tossTeam(team))}</button>`;
  }
  return players
    .map(
      (player) =>
        `<button class="tossbig" onclick="${action(player.id, player.name)}">${esc(player.name)}</button>`,
    )
    .join('');
}

function tossChoices() {
  const taken = tossing.picks[0]?.choice;
  const button = (choice, label) =>
    `<button class="tossbig" onclick="tossPick('${choice}')">${label}</button>`;
  const serveOrReceive = button('SERVE', 'Serve first') + button('RECEIVE', 'Receive first');
  const end = button('SIDE', 'Pick an end');
  if (taken === 'SIDE') return serveOrReceive;
  if (taken) return end;
  return (
    serveOrReceive + end + (tossing.deferred ? '' : button('DEFER', 'Defer: let them pick first'))
  );
}

function tossScreen() {
  const chooser = tossing.chooser;
  switch (tossing.step) {
    case 'summon': {
      const failed = tossing.callFailed
        ? '<p class="tosshint">That didn\'t go through. Press it again.</p>'
        : '';
      // A team entered without its players' names has nothing to tick.
      const named = [1, 2].every((team) => (playersOf(team) || []).length);
      return tossing.called
        ? `<h1>Players called</h1>
          <p class="tosshint">${named ? 'They sign in on the monitor, or tap a name here.' : "It's on the court's monitor and the stream."}</p>${failed}
          ${
            named
              ? [1, 2]
                  .map(
                    (team) =>
                      `<div class="tossgroup"><h2>${esc(tossTeam(team))}</h2>${arrivalNames(team)}</div>`,
                  )
                  .join('')
              : '<button class="tossgo" onclick="playersHere()">Players are here</button>'
          }
          <button class="tossgo" onclick="callPlayers()">Call again</button>`
        : `<h1>Are the players here?</h1>
          <p class="tosshint">Calling them puts it on the court's monitor and the stream.</p>${failed}
          <button class="tossgo" onclick="callPlayers()">Call the players</button>
          <button class="tossbig" onclick="playersHere()">They're already here</button>`;
    }
    case 'call':
      return `<h1>Press your name</h1><p class="tosshint">You'll call the coin.</p>
        ${[1, 2]
          .map(
            (team) => `<div class="tossgroup"><h2>${esc(tossTeam(team))}</h2>
          ${tossNames(team, (id, name) => `tossCaller(${team}, ${JSON.stringify(name).replace(/"/g, '&quot;')})`)}</div>`,
          )
          .join('')}`;
    case 'face':
      return `<h1>${esc(tossing.name)}, heads or tails?</h1>
        <div class="tossfaces">
          <button class="tossface" onclick="tossCall('HEADS')"><span class="tosscoin">H</span>Heads</button>
          <button class="tossface" onclick="tossCall('TAILS')"><span class="tosscoin">T</span>Tails</button>
        </div>`;
    case 'flip':
      return `<h1>${esc(tossing.name)} called ${tossing.call === 'HEADS' ? 'heads' : 'tails'}</h1>
        <div class="tossfaces"><span class="tosscoin huge spin"></span></div>`;
    case 'won':
      return `<h1>${tossing.result === 'HEADS' ? 'Heads' : 'Tails'}!</h1>
        <div class="tossfaces"><span class="tosscoin huge">${tossing.result === 'HEADS' ? 'H' : 'T'}</span></div>
        <p class="tosswin">${esc(tossTeam(tossWinner()))} won the toss</p>
        <button class="tossgo" onclick="tossChoose()">${esc(tossTeam(tossWinner()))} choose</button>`;
    case 'choose':
      return `<h1>${esc(tossTeam(chooser))}</h1>
        <p class="tosshint">${tossing.picks.length ? "You take what's left." : 'You choose first.'}</p>
        ${tossChoices()}`;
    case 'end':
      return `<h1>${esc(tossTeam(chooser))}</h1><p class="tosshint">Which end do you want?</p>
        <div class="tossfaces">
          <button class="tossbig" onclick="tossEnd('FRONT')">Main entrance</button>
          <button class="tossbig" onclick="tossEnd('BACK')">Second entrance</button>
        </div>`;
    case 'right': {
      const serves = tossing.rightTeam === tossServing();
      return `<h1>${esc(tossTeam(tossing.rightTeam))}</h1>
        <p class="tosshint">Who ${serves ? 'serves' : 'receives'} first? They start on the right.</p>
        ${tossNames(tossing.rightTeam, (id) => `tossRight(${id})`)}`;
    }
    default:
      return `<h1>Turn the phone back to the ref</h1>
        <button class="tossgo" onclick="tossHandBack()">Ref: check the court</button>`;
  }
}

function renderToss() {
  let el = document.getElementById('tossPage');
  if (!el) {
    el = document.createElement('div');
    el.id = 'tossPage';
    el.className = 'tosspage';
    document.body.appendChild(el);
  }
  el.innerHTML = `
    <div class="tosstop">
      <button class="tossback" onclick="tossBack()" aria-label="Back to the court">‹</button>
      <div class="tossvs">${esc(match.team1)} vs ${esc(match.team2)}</div>
      ${tossing.step === 'summon' ? '<span></span>' : '<button class="tossback" onclick="tossToRef()">Ref setup</button>'}
    </div>
    <div class="tossmain"><div class="tossbody">${tossScreen()}</div>${tossSummary()}</div>
    ${tossing.step === 'call' || tossing.step === 'summon' ? '' : '<button class="tossagain" onclick="openToss()">Start again</button>'}`;
}
