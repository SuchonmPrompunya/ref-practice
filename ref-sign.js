/* The signing page at the end of a match, shared by both referee layouts. The
   score page's "Sign to complete" opens it, and the referee can go back and forth:
   anything signed stays until the score changes. It sits outside the page, so a
   re-render underneath doesn't touch it. Both teams are asked, but either or both
   can be missing: the result already counts, and nobody leaving the court can hold
   up a bracket. */
let signing = null; // { matchId, score, signatures: [team1, team2], open }

// The picture follows the box's shape, up to this wide, to keep the upload small.
const SIGN_MAX_WIDTH = 1000;

async function openSignatures() {
  const score = finalScoreLabel();
  const known = signing != null && signing.matchId === match.match_id && signing.score === score;
  if (!known) signing = { matchId: match.match_id, score, signatures: [null, null], open: true };
  signing.open = true;
  renderSignatures();
  if (known) return;

  // Someone reopening a finished match sees what was already signed.
  const opening = signing;
  try {
    const { data } = await api(
      'GET',
      `/tournaments/${TOURNAMENT}/matches/${match.match_id}/signatures`,
    );
    if (signing !== opening) return;
    data.forEach((row) => {
      signing.signatures[row.team - 1] = row.signature;
    });
    if (signing.open) renderSignatures();
  } catch (e) {
    // No wifi: start with empty boxes. Signing still works, and catches up later.
  }
}

function closeSignatures() {
  if (signing) signing.open = false;
  document.getElementById('signPage')?.remove();
}

function finalScoreLabel() {
  return games.length ? games.map((g) => g.join('–')).join('  ') : `${s1}–${s2}`;
}

function completeLabel() {
  const count = signing.signatures.filter((signature) => signature != null).length;
  if (count === 2) return 'Complete match';
  return count === 1 ? 'Complete with 1 signature' : 'Complete without signatures';
}

function renderSignatures() {
  let el = document.getElementById('signPage');
  if (!el) {
    el = document.createElement('div');
    el.id = 'signPage';
    el.className = 'signpage';
    document.body.appendChild(el);
  }
  const pad = (team, name) => `
    <div class="signteam">
      <div class="signhead">
        <span class="signname">${esc(name)}</span>
        <button class="signclear" onclick="clearSignature(${team})">Clear</button>
      </div>
      <canvas class="signbox" id="sign${team}" aria-label="Signature for ${esc(name)}"></canvas>
    </div>`;
  el.innerHTML = `
    <div class="signtop">
      <button class="signback" onclick="closeSignatures()" aria-label="Back to the score">‹ Score</button>
      <div class="signscore">${esc(match.team1)} <b>${esc(signing.score)}</b> ${esc(match.team2)}</div>
    </div>
    <div class="signpads">
      ${pad(1, match.team1)}
      ${pad(2, match.team2)}
    </div>
    <button class="signdone" id="signDone" onclick="completeSigned()">${completeLabel()}</button>`;
  [1, 2].forEach(startPad);
}

function startPad(team) {
  const canvas = document.getElementById(`sign${team}`);
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(window.devicePixelRatio || 1, SIGN_MAX_WIDTH / rect.width);
  canvas.width = Math.round(rect.width * scale);
  canvas.height = Math.round(rect.height * scale);
  const ctx = canvas.getContext('2d');
  const style = () => {
    ctx.lineWidth = 3 * scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0b1530';
  };
  style();

  // One already signed fits inside the box, whatever shape it was signed in.
  const existing = signing.signatures[team - 1];
  if (existing != null) {
    const image = new Image();
    image.onload = () => {
      const fit = Math.min(canvas.width / image.width, canvas.height / image.height);
      const [w, h] = [image.width * fit, image.height * fit];
      ctx.drawImage(image, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
      style();
    };
    image.src = existing;
  }

  const at = (event) => {
    const box = canvas.getBoundingClientRect();
    return [
      ((event.clientX - box.left) / box.width) * canvas.width,
      ((event.clientY - box.top) / box.height) * canvas.height,
    ];
  };
  let drawing = false;
  canvas.addEventListener('pointerdown', (event) => {
    drawing = true;
    canvas.setPointerCapture(event.pointerId);
    const [x, y] = at(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
    // A dot, for a tap that never moves.
    ctx.lineTo(x + 0.1, y);
    ctx.stroke();
    event.preventDefault();
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drawing) return;
    const [x, y] = at(event);
    ctx.lineTo(x, y);
    ctx.stroke();
  });
  const finish = () => {
    if (!drawing) return;
    drawing = false;
    signing.signatures[team - 1] = canvas.toDataURL('image/png');
    document.getElementById('signDone').textContent = completeLabel();
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
}

function clearSignature(team) {
  signing.signatures[team - 1] = null;
  const canvas = document.getElementById(`sign${team}`);
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  document.getElementById('signDone').textContent = completeLabel();
}

async function completeSigned() {
  document.getElementById('signDone').disabled = true;
  const path = `/tournaments/${TOURNAMENT}/matches/${match.match_id}/signatures`;
  const body = { team1: signing.signatures[0], team2: signing.signatures[1] };
  // After the score itself: the server drops signatures for a score that changes.
  await pushChain;
  try {
    await api('PUT', path, body);
  } catch {
    queue({ path, body });
  }
  closeSignatures();
  signing = null;
  backToCourt();
}

// Turning the phone changes the boxes' shape, so they're drawn again to fit.
window.addEventListener('resize', () => {
  if (signing?.open) renderSignatures();
});
