// Mini music player. Once opened it stays on screen on every page.
// ✏️ Put the song at public/music/music.mp3
export const SONG = {
  title: '4ME 4ME',
  src: 'music/music.mp3',
  volume: 0.6, // starting volume, 0 (silent) to 1 (full)
};

const VOLUME_KEY = 'player-volume';

const $ = (id) => document.getElementById(id);

const PLAY = '<svg viewBox="0 0 7 7" shape-rendering="crispEdges" aria-hidden="true"><path d="M1 0h1v7H1zM2 1h1v5H2zM3 2h1v3H3zM4 3h1v1H4z"/></svg>';
const PAUSE = '<svg viewBox="0 0 7 7" shape-rendering="crispEdges" aria-hidden="true"><path d="M1 0h2v7H1zM4 0h2v7H4z"/></svg>';

const SPEAKER = '<svg viewBox="0 0 9 7" shape-rendering="crispEdges" aria-hidden="true"><path d="M0 2h2v3H0zM2 1h1v5H2zM3 0h1v7H3z"/><path class="waves" d="M5 2h1v3H5zM7 1h1v5H7z"/></svg>';
const MUTED = '<svg viewBox="0 0 9 7" shape-rendering="crispEdges" aria-hidden="true"><path d="M0 2h2v3H0zM2 1h1v5H2zM3 0h1v7H3zM5 2h1v1H5zM6 3h1v1H6zM7 4h1v1H7zM7 2h1v1H7zM5 4h1v1H5z"/></svg>';

// Remember the volume between visits (ignored if the browser blocks storage).
function savedVolume() {
  try {
    const v = parseFloat(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(v) ? v : SONG.volume;
  } catch {
    return SONG.volume;
  }
}

const time = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');

export function setupPlayer() {
  const player = $('player');
  const audio = new Audio();
  audio.loop = true;
  audio.preload = 'none';

  const toggle = $('player-toggle');
  const seek = $('player-seek');
  const volume = $('player-volume');
  const mute = $('player-mute');

  // iPhone ignores audio.volume, so the sound goes through a Web Audio gain
  // node instead (set up on the first tap, which iOS requires).
  let level = savedVolume();
  let lastVolume = level || SONG.volume;
  let context = null;
  let gain = null;
  const Context = window.AudioContext || window.webkitAudioContext;
  const connectAudio = () => {
    if (!context && Context) {
      try {
        context = new Context();
        gain = context.createGain();
        context.createMediaElementSource(audio).connect(gain).connect(context.destination);
      } catch {
        context = gain = null;
      }
    }
    context?.resume();
    applyVolume();
  };
  const applyVolume = () => {
    if (gain) {
      gain.gain.value = level;
      audio.volume = 1;
    } else {
      audio.volume = level;
    }
  };
  // Play even when the iPhone's silent switch is on (Safari 17+).
  if (navigator.audioSession) navigator.audioSession.type = 'playback';

  const showVolume = () => {
    const v = level;
    volume.value = v;
    volume.style.setProperty('--fill', `${v * 100}%`);
    $('player-volume-value').textContent = `${Math.round(v * 100)}%`;
    mute.innerHTML = v === 0 ? MUTED : SPEAKER;
    mute.setAttribute('aria-label', v === 0 ? 'Unmute' : 'Mute');
  };
  const setVolume = (v) => {
    level = v;
    applyVolume();
    if (v > 0) lastVolume = v;
    showVolume();
    try {
      localStorage.setItem(VOLUME_KEY, String(v));
    } catch {}
  };
  volume.addEventListener('input', () => setVolume(Number(volume.value)));
  mute.addEventListener('click', () => setVolume(level === 0 ? lastVolume : 0));
  applyVolume();
  showVolume();

  $('player-title').textContent = SONG.title;
  $('player-bar-title').textContent = `now playing: ${SONG.title}`;

  const update = () => {
    const playing = !audio.paused && !audio.error;
    toggle.innerHTML = playing ? PAUSE : PLAY;
    toggle.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    player.classList.toggle('is-playing', playing);
  };
  const progress = () => {
    if (audio.error) return;
    seek.max = audio.duration || 0;
    if (!seek.matches(':active')) seek.value = audio.currentTime;
    $('player-time').textContent = `${time(audio.currentTime)} / ${time(audio.duration)}`;
  };

  audio.addEventListener('play', update);
  audio.addEventListener('pause', update);
  audio.addEventListener('timeupdate', progress);
  audio.addEventListener('loadedmetadata', progress);
  audio.addEventListener('error', () => {
    $('player-time').textContent = `missing ${SONG.src}`;
    update();
  });

  const play = () => {
    connectAudio();
    audio.play().catch(() => {});
  };
  toggle.addEventListener('click', () => (audio.paused ? play() : audio.pause()));
  seek.addEventListener('input', () => {
    audio.currentTime = Number(seek.value);
  });
  $('player-close').addEventListener('click', () => {
    audio.pause();
    player.hidden = true;
  });

  // Minimize to just the title bar (handy on phones, where it covers more).
  const minimize = $('player-min');
  minimize.addEventListener('click', () => {
    const min = player.classList.toggle('is-min');
    minimize.textContent = min ? '+' : '_';
    minimize.setAttribute('aria-label', min ? 'Expand player' : 'Minimize player');
  });

  update();

  // Called by the music icon in the explorer.
  return function openPlayer() {
    if (!audio.src) audio.src = SONG.src;
    player.hidden = false;
    play();
  };
}
