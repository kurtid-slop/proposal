// npm run letter-image
// Draws each letter that has `asImage` (src/letters.js) in the LiebeHeide
// handwriting font, solid INK on a plain PAPER background, and saves it to
// public/<asImage>. It uses headless Chrome so it comes out the same everywhere.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { LETTERS } from '../src/letters.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONT = path.join(root, 'newfonts/LiebeHeide-Color-iF66f2f6065f2e8.otf');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WIDTH = 900; // css px; saved at 2x
const PAPER = '#fffdf4'; // background
const INK = '#5f3460'; // text colour
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const escape = (text) => text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

const page = (letter) => `<!doctype html>
<meta charset="utf-8" />
<style>
  @font-face { font-family: 'LiebeHeide'; src: url('${pathToFileURL(FONT)}'); }
  html, body { margin: 0; background: ${PAPER}; }
  #paper {
    width: ${WIDTH}px;
    box-sizing: border-box;
    padding: 80px 72px;
    background: ${PAPER};
    font: 44px/1.2 'LiebeHeide', cursive;
  }
  /* the font's glyphs are blue-ink pictures, so CSS colour can't change them;
     this filter repaints every glyph in one solid colour, a little bolder */
  #text { filter: url(#solid); }
  p { margin: 0; min-height: 1.2em; }
</style>
<svg width="0" height="0" style="position:absolute">
  <filter id="solid" color-interpolation-filters="sRGB">
    <feMorphology in="SourceAlpha" operator="dilate" radius="0.6" result="bold" />
    <feFlood flood-color="${INK}" />
    <feComposite in2="bold" operator="in" />
  </filter>
</svg>
<div id="paper"><div id="text">${letter.lines.map((line) => `<p>${escape(line)}</p>`).join('')}</div></div>`;

const letters = Object.values(LETTERS).filter((letter) => letter.asImage);
if (!letters.length) process.exit(0);

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'letter-image-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9334', `--user-data-dir=${profile}`, '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
try {
  let targets;
  for (let i = 0; i < 40 && !targets; i++) {
    await sleep(250);
    targets = await fetch('http://127.0.0.1:9334/json').then((r) => r.json()).catch(() => null);
  }
  if (!targets) throw new Error(`couldn't start Chrome at ${CHROME} (set CHROME=/path/to/chrome)`);
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = {};
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    pending[d.id]?.(d.result);
  };
  const send = (method, params = {}) => new Promise((r) => { pending[++id] = r; ws.send(JSON.stringify({ id, method, params })); });

  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 800, deviceScaleFactor: 2, mobile: false });
  for (const letter of letters) {
    const html = path.join(profile, 'letter.html');
    fs.writeFileSync(html, page(letter));
    await send('Page.navigate', { url: pathToFileURL(html).href });
    await sleep(500);
    const { result } = await send('Runtime.evaluate', {
      expression: `document.fonts.ready.then(() => document.fonts.check("44px LiebeHeide") ? document.getElementById('paper').offsetHeight : 0)`,
      awaitPromise: true,
    });
    if (!result.value) throw new Error('the font did not load');
    const shot = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: WIDTH, height: result.value, scale: 1 },
    });
    const out = path.join(root, 'public', letter.asImage);
    await sharp(Buffer.from(shot.data, 'base64')).jpeg({ quality: 88, mozjpeg: true }).toFile(out);
    console.log(`${letter.title} -> public/${letter.asImage}`);
  }
  ws.close();
} finally {
  chrome.kill();
  await new Promise((r) => (chrome.exitCode !== null ? r() : chrome.once('exit', r)));
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
}
