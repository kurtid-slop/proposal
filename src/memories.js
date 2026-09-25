import { applyCrop, getCrop } from './crop.js';
import { SATURATION } from './photo-settings.js';

document.documentElement.style.setProperty('--photo-saturation', SATURATION);

// Photos: drop them into the /memories folder at the project root.
// HEIC photos from iPhone work too.
// Every photo is shrunk (and HEIC converted to JPEG) by photos-plugin.js.
const files = import.meta.glob(
  '/memories/*.{jpg,jpeg,png,webp,avif,heic,heif,JPG,JPEG,PNG,WEBP,AVIF,HEIC,HEIF}',
  { eager: true, query: '?photo', import: 'default' },
);

// One entry per photo: if the same name exists as both HEIC and JPG
// (e.g. IMG_8015.HEIC + IMG_8015.jpeg), only one copy is used.
const byName = new Map();
for (const [file, url] of Object.entries(files)) {
  byName.set(file.replace(/\.[^.]+$/, '').toLowerCase(), { name: file.split('/').pop(), url });
}
// Sorted by name (IMG_7909, IMG_7910, ...) so neighbours are photos taken close together.
const photos = [...byName.entries()]
  .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
  .map(([, photo]) => photo);

// Fisher-Yates shuffle: a random order every time the page opens.
function shuffled(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ✏️ Scroll speed of the tapes, in pixels per second
const SPEED = 40;

// Top and bottom tapes move right, middle one moves left.
const DIRECTIONS = ['right', 'left', 'right'];

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let tapes = [];
let raf = 0;

function frame(photo) {
  const el = document.createElement('div');
  el.className = 'film__frame';
  const win = document.createElement('div');
  win.className = 'film__window';
  el.append(win);
  if (photo) {
    const img = document.createElement('img');
    img.src = photo.url;
    img.alt = photo.name;
    img.dataset.name = photo.name;
    img.decoding = 'async';
    img.draggable = false;
    applyCrop(img, getCrop(photo.name));
    win.append(img);
    // Filename label, shown when hovering the photo
    const name = document.createElement('span');
    name.className = 'film__name';
    name.textContent = photo.name;
    el.append(name);
  }
  return el;
}

// Keeps the offset inside one loop (-loop, 0], so the two copies wrap seamlessly.
const wrap = (x, loop) => (loop ? ((x % loop) - loop) % loop : 0);

function render(tape) {
  tape.offset = wrap(tape.offset, tape.loop);
  tape.track.style.transform = `translate3d(${tape.offset}px, 0, 0)`;
}

function step(tape, dt) {
  if (!tape.drag) {
    // Glide after a flick, slowing down smoothly.
    if (Math.abs(tape.velocity) > 5) {
      tape.offset += tape.velocity * dt;
      tape.velocity *= Math.pow(0.03, dt);
    } else {
      tape.velocity = 0;
    }
    if (!tape.hover && !reducedMotion.matches) tape.offset += tape.dir * SPEED * dt;
  }
  render(tape);
}

// Mouse wheel / trackpad, click-and-drag, and touch swipe.
function attachInput(el, tape) {
  el.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'mouse') tape.hover = true;
  });
  el.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') tape.hover = false;
  });

  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : 1;
      tape.offset -= (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * unit;
      tape.velocity = 0;
    },
    { passive: false },
  );

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    tape.drag = { lastX: e.clientX, lastT: e.timeStamp, moved: 0, v: 0 };
    tape.velocity = 0;
    el.setPointerCapture(e.pointerId);
  });

  el.addEventListener('pointermove', (e) => {
    const d = tape.drag;
    if (!d) return;
    const dx = e.clientX - d.lastX;
    const dt = e.timeStamp - d.lastT;
    tape.offset += dx;
    render(tape); // move with the finger right away, not on the next frame
    d.moved += Math.abs(dx);
    if (dt > 0) d.v = (dx / dt) * 1000;
    d.lastX = e.clientX;
    d.lastT = e.timeStamp;
    if (d.moved > 5) el.classList.add('is-dragging');
  });

  const end = (e) => {
    const d = tape.drag;
    if (!d) return;
    tape.drag = null;
    el.classList.remove('is-dragging');
    if (d.moved > 5) {
      // Only fling if the pointer was still moving when released.
      tape.velocity = e.timeStamp - d.lastT < 80 ? d.v : 0;
    } else if (e.type === 'pointerup') {
      onPhotoClick(e);
    }
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

// Tapping a photo shows its name for a moment (touch screens have no hover).
// While running `npm run dev`, clicking a photo opens the crop editor instead.
function onPhotoClick(e) {
  const frameEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('.film__frame');
  const img = frameEl?.querySelector('img');
  if (!img) return;
  if (!import.meta.env.DEV) {
    frameEl.classList.add('show-name');
    clearTimeout(frameEl.nameTimer);
    frameEl.nameTimer = setTimeout(() => frameEl.classList.remove('show-name'), 2000);
    return;
  }
  const name = img.dataset.name;
  import('./crop-editor.js').then(({ openCropEditor }) =>
    openCropEditor({ name, url: img.src }, () => {
      for (const other of document.querySelectorAll('.film__window img')) {
        if (other.dataset.name === name) applyCrop(other, getCrop(name));
      }
    }),
  );
}

// Fills `container` with three looping film tapes.
export function buildTapes(container) {
  stopTapes();
  container.replaceChildren();

  // Deal the name-sorted photos out like cards (1st to tape A, 2nd to B, 3rd to C, 4th to A...),
  // so photos with neighbouring names always end up on different tapes.
  // A random starting tape, then a shuffle within each tape, keeps it random.
  const start = Math.floor(Math.random() * DIRECTIONS.length);
  const groups = DIRECTIONS.map((_, t) =>
    shuffled(photos.filter((_, i) => (i + start) % DIRECTIONS.length === t)),
  );

  tapes = DIRECTIONS.map((direction, t) => {
    const el = document.createElement('div');
    el.className = 'film';
    const track = document.createElement('div');
    track.className = 'film__track';
    el.append(track);
    container.append(el);

    // Each photo appears once per loop. Only if a tape has too few photos to
    // cover the screen do they repeat (otherwise there'd be a visible gap).
    const group = groups[t];
    const frameWidth = (el.clientHeight * 37) / 34;
    const count = Math.max(group.length, Math.ceil(window.innerWidth / frameWidth) + 1);
    const sequence = Array.from({ length: count }, (_, i) =>
      group.length ? group[i % group.length] : null,
    );
    // Two copies back to back; the offset wraps after exactly one copy's width.
    for (const photo of [...sequence, ...sequence]) track.append(frame(photo));

    const tape = {
      track,
      dir: direction === 'right' ? 1 : -1,
      loop: track.scrollWidth / 2,
      offset: 0,
      velocity: 0,
      hover: false,
      drag: null,
    };
    attachInput(el, tape);
    return tape;
  });

  let last = performance.now();
  const tick = (now) => {
    const dt = Math.min(now - last, 100) / 1000;
    last = now;
    for (const tape of tapes) step(tape, dt);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

export function stopTapes() {
  cancelAnimationFrame(raf);
  tapes = [];
}
