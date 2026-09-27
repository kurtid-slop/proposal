import './style.css';
import { folderSvg, heartSvg, questionSvg } from './pixels.js';
import { setupPlayer } from './player.js';
import {
  FOLDER_PASSWORD,
  MESSAGE,
  NO_LIMIT,
  NO_MESSAGE,
  QUESTION,
  TYPING,
  WRONG_PASSWORD,
  YES_MESSAGE,
} from './message.js';
import { typeLines } from './typewriter.js';
import { buildTapes, stopTapes } from './memories.js';
import { setupFanEdit } from './fan-edit.js';
import { LETTERS } from './letters.js';
import { saveImage } from './save-image.js';

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

$('folder-art').innerHTML = folderSvg();
$('question-art').innerHTML = questionSvg();
$('letters-art').innerHTML = folderSvg();

// Desktop folder -> password prompt -> explorer window.
// Once unlocked it stays unlocked until the page is reloaded.
let unlocked = false;

async function openDesktopFolder() {
  $('desktop').classList.add('is-leaving');
  await wait(450);
  $('desktop').hidden = true;
  $('desktop').classList.remove('is-leaving');
  $('explorer-screen').hidden = false;
}

function closeLock() {
  $('lock').hidden = true;
  $('lock-form').classList.remove('is-shaking');
  $('lock-input').value = '';
  $('lock-error').hidden = true;
}

$('folder').addEventListener('click', () => {
  if (unlocked) return openDesktopFolder();
  $('lock').hidden = false;
  $('lock-input').focus();
});

$('lock-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('lock-input');
  if (input.value.trim().toLowerCase() === FOLDER_PASSWORD.toLowerCase()) {
    unlocked = true;
    closeLock();
    openDesktopFolder();
    return;
  }
  // wrong: shake the window and show the error
  const win = $('lock-form');
  win.classList.remove('is-shaking');
  void win.offsetWidth; // restart the animation if it's already run
  win.classList.add('is-shaking');
  $('lock-error').textContent = WRONG_PASSWORD;
  $('lock-error').hidden = false;
  input.value = '';
  input.focus();
});

// Clear the shake once it's played, so it doesn't replay when the prompt reopens.
$('lock-form').addEventListener('animationend', (e) => {
  if (e.animationName === 'shake') $('lock-form').classList.remove('is-shaking');
});

$('lock-close').addEventListener('click', closeLock);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('lock').hidden) closeLock();
});

// Folders inside the explorer window. Back goes up a folder (or out to the
// desktop from the top), forward returns to the folder you just left.
const FOLDERS = {
  root: { title: 'skater-girl', path: 'C:\\Users\\alix\\skater-girl\\' },
  letters: { title: 'letters', path: 'C:\\Users\\alix\\skater-girl\\letters\\' },
};
let currentFolder = 'root';
let forwardFolder = null;

function openFolder(name) {
  currentFolder = name;
  for (const list of document.querySelectorAll('.explorer__files')) list.hidden = list.dataset.folder !== name;
  $('explorer-title').textContent = FOLDERS[name].title;
  $('explorer-address').textContent = FOLDERS[name].path;
  $('explorer-forward').disabled = !forwardFolder;
  updateStatus();
}

function closeExplorer() {
  forwardFolder = null;
  openFolder('root');
  $('explorer-screen').hidden = true;
  $('desktop').hidden = false;
}

$('explorer-close').addEventListener('click', closeExplorer);
$('explorer-back').addEventListener('click', () => {
  if (currentFolder === 'root') return closeExplorer();
  forwardFolder = currentFolder;
  openFolder('root');
});
$('explorer-forward').addEventListener('click', () => {
  const next = forwardFolder;
  forwardFolder = null;
  if (next) openFolder(next);
});

// memories.exe -> film tapes page
$('open-memories').addEventListener('click', () => {
  $('explorer-screen').hidden = true;
  $('memories-screen').hidden = false;
  if (import.meta.env.DEV) $('memories-screen').classList.add('is-editable');
  buildTapes($('tapes'));
});

// skater-girl.scrapbook -> scrollable scrapbook (image only loads once opened)
$('open-scrapbook').addEventListener('click', () => {
  const img = $('scrapbook-img');
  if (!img.getAttribute('src')) img.src = 'scrapbook/skater-girl.jpg';
  $('explorer-screen').hidden = true;
  $('scrapbook-screen').hidden = false;
  $('scrapbook-scroll').scrollTop = 0;
});

$('scrapbook-close').addEventListener('click', () => {
  $('scrapbook-screen').hidden = true;
  $('explorer-screen').hidden = false;
});

$('memories-close').addEventListener('click', () => {
  $('memories-screen').hidden = true;
  stopTapes();
  $('tapes').replaceChildren();
  $('explorer-screen').hidden = false;
});

// Rebuild tapes on resize so they always cover the screen
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!$('memories-screen').hidden) buildTapes($('tapes'));
  }, 200);
});

// mini music player; opened by memories-fanedit.exe, stays visible on every page
const openPlayer = setupPlayer();

// ?.exe -> message typed out, then the question
// (types once; going back and reopening shows it finished, or still typing)
let typed = false;
$('open-question').addEventListener('click', async () => {
  $('explorer-screen').hidden = true;
  $('proposal-screen').hidden = false;
  if (typed) return;
  typed = true;
  await typeLines($('proposal-message'), MESSAGE, TYPING);
  // start loading the "yes" page gifs now, so they're ready when she answers
  for (const gif of document.querySelectorAll('.yay__gif')) gif.src ||= gif.dataset.src;
  await typeLines($('proposal-question'), [QUESTION], TYPING);
  $('proposal-answers').hidden = false;
});

// "no" jumps somewhere else on screen at a random size, never on top of "yes"
const overlaps = (a, b, gap = 12) =>
  a.left < b.right + gap && a.right > b.left - gap && a.top < b.bottom + gap && a.bottom > b.top - gap;

let noClicks = 0;

// Too many "no"s: show "ok...", then go back to the alix folder.
// The "no" button resets, so ?.exe can be tried again.
async function giveUp() {
  const no = $('answer-no');
  noClicks = 0;
  no.classList.remove('is-loose');
  no.style.cssText = '';

  $('proposal-screen').hidden = true;
  $('ok-screen').hidden = false;
  $('ok-text').replaceChildren();
  await typeLines($('ok-text'), [NO_MESSAGE], { ...TYPING, charDelay: 180, keepCursor: true });
  await wait(1500);
  $('ok-screen').hidden = true;
  $('desktop').hidden = false;
}

$('answer-no').addEventListener('click', () => {
  if (++noClicks >= NO_LIMIT) {
    giveUp();
    return;
  }
  const no = $('answer-no');
  no.style.fontSize = `${Math.round(12 + Math.random() * 26)}px`; // 12–38px
  no.classList.add('is-loose');

  const { width, height } = no.getBoundingClientRect();
  const margin = 16;
  const avoid = [$('answer-yes'), $('proposal-close'), $('player')]
    .filter((el) => !el.hidden)
    .map((el) => el.getBoundingClientRect());
  for (let tries = 0; tries < 30; tries++) {
    const left = margin + Math.random() * Math.max(0, window.innerWidth - width - margin * 2);
    const top = margin + Math.random() * Math.max(0, window.innerHeight - height - margin * 2);
    const box = { left, top, right: left + width, bottom: top + height };
    if (tries === 29 || !avoid.some((r) => overlaps(box, r))) {
      no.style.left = `${left}px`;
      no.style.top = `${top}px`;
      break;
    }
  }
});

// "yes" -> page with the gifs and the yes message, then back to the explorer
$('answer-yes').addEventListener('click', async () => {
  for (const gif of document.querySelectorAll('.yay__gif')) gif.src ||= gif.dataset.src;
  $('proposal-screen').hidden = true;
  $('yay-screen').hidden = false;
  $('yay-continue').hidden = true;
  $('yay-message').replaceChildren();

  // pixel hearts floating up the screen
  const hearts = $('hearts');
  if (!hearts.childElementCount) {
    for (let i = 0; i < 24; i++) {
      const heart = document.createElement('span');
      heart.className = 'heart';
      heart.innerHTML = heartSvg();
      heart.style.left = `${Math.random() * 100}%`;
      heart.style.setProperty('--size', `${16 + Math.round(Math.random() * 28)}px`);
      heart.style.animationDuration = `${5 + Math.random() * 5}s`;
      heart.style.animationDelay = `${-Math.random() * 10}s`;
      hearts.append(heart);
    }
  }

  await typeLines($('yay-message'), YES_MESSAGE, TYPING);
  $('yay-continue').hidden = false;
});

$('yay-continue').addEventListener('click', () => {
  $('yay-screen').hidden = true;
  $('explorer-screen').hidden = false;
  unlockAfterYes(true);
});

// "memories-fanedit.exe": appears in the explorer once she says yes
// (remembered in this browser, so it's still there after a reload)
const SAID_YES_KEY = 'said-yes';

function updateStatus() {
  const count = [...document.querySelectorAll('.explorer__files:not([hidden]) .file')].filter((f) => !f.hidden).length;
  $('explorer-status').textContent = `${count} object${count === 1 ? '' : 's'}`;
}

const UNLOCKED_AFTER_YES = ['open-fan-edit'];

function unlockAfterYes(animate) {
  for (const id of UNLOCKED_AFTER_YES) {
    const icon = $(id);
    if (!icon.hidden) continue;
    icon.hidden = false;
    if (animate) icon.classList.add('is-new');
  }
  updateStatus();
  try {
    localStorage.setItem(SAID_YES_KEY, '1');
  } catch {}
}

try {
  if (localStorage.getItem(SAID_YES_KEY)) unlockAfterYes(false);
} catch {}
updateStatus();

// memories-fanedit.exe -> swipeable posts
const openFanEdit = setupFanEdit();
$('open-fan-edit').addEventListener('click', () => {
  $('explorer-screen').hidden = true;
  $('fan-screen').hidden = false;
  openFanEdit();
  openPlayer(); // plays 4ME 4ME
});

// letters -> C:\Users\alix\letters\
$('open-letters').addEventListener('click', () => {
  forwardFolder = null;
  openFolder('letters');
});

// letters -> the chosen letter on lined paper, with its picture at the bottom
function showLetter(id) {
  const letter = LETTERS[id];
  const paper = $('letter-paper');
  paper.replaceChildren(
    ...letter.lines.map((text) => {
      const p = document.createElement('p');
      p.className = 'line';
      p.textContent = text;
      return p;
    }),
  );

  if (letter.image) {
    // same look as the fan edit posts: framed picture with a download button
    const post = document.createElement('figure');
    post.className = 'window letter__post';
    post.innerHTML = `
      <div class="letter__post-image"><img alt="" /></div>
      <figcaption class="fan__footer">
        <span class="fan__count"></span>
        <button class="btn btn--primary fan__download" type="button">download</button>
      </figcaption>`;
    post.querySelector('img').src = letter.image;
    post.querySelector('.fan__count').textContent = letter.title;
    const button = post.querySelector('button');
    button.addEventListener('click', () => saveImage(letter.image, letter.image.split('/').pop(), button));
    paper.append(post);
  }

  $('letter-title').textContent = letter.title;
  $('letter-window').setAttribute('aria-label', letter.title);
  $('explorer-screen').hidden = true;
  $('letter-screen').hidden = false;
  paper.scrollTop = 0;
  playLetterAnimation();
}

// Opening animation: the envelope pops in and wiggles, then drops away
// as the letter slides up out of it.
let letterAnimation = 0;
async function playLetterAnimation() {
  const screen = $('letter-screen');
  const run = ++letterAnimation; // a newer open (or close) cancels this one
  screen.classList.remove('is-opening', 'is-revealing');
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  screen.classList.add('is-opening');
  await wait(750);
  if (run !== letterAnimation) return;
  screen.classList.replace('is-opening', 'is-revealing');
  await wait(550);
  if (run !== letterAnimation) return;
  screen.classList.remove('is-revealing');
}

for (const icon of document.querySelectorAll('[data-letter]')) {
  icon.addEventListener('click', () => showLetter(icon.dataset.letter));
}

$('letter-close').addEventListener('click', () => {
  letterAnimation++;
  $('letter-screen').classList.remove('is-opening', 'is-revealing');
  $('letter-screen').hidden = true;
  $('explorer-screen').hidden = false;
});

$('fan-close').addEventListener('click', () => {
  $('fan-screen').hidden = true;
  $('explorer-screen').hidden = false;
});

$('proposal-close').addEventListener('click', () => {
  $('proposal-screen').hidden = true;
  $('explorer-screen').hidden = false;
});
