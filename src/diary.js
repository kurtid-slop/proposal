// "skater-girl-2.diary": a book entry ported from the Scrapbook Diary app.
// The entry is kept exactly as that app saves it, so it stays encrypted until
// the right password is typed in (decryption happens in the browser). Pages
// turn like a real book via the app's own book engine (public/diary-book/).
// While running `npm run dev` the book can also be edited — see diary-editor.js.
// ✏️ The entry lives in /diary/skater-girl-2/ (entry.json + uploads/).
import './diary-book.css';
import entry from '/diary/skater-girl-2/entry.json';

export const ENTRY_NAME = 'skater-girl-2';

// Photos are shrunk by photos-plugin.js; the entry refers to them by file name.
const uploads = import.meta.glob('/diary/skater-girl-2/uploads/*', {
  eager: true,
  query: '?photo',
  import: 'default',
});
const uploadUrls = Object.fromEntries(Object.entries(uploads).map(([file, url]) => [file.split('/').pop(), url]));

export function imageUrl(stored) {
  if (!stored) return '';
  const name = String(stored).split('/').pop();
  if (uploadUrls[name]) return uploadUrls[name];
  // a photo just added in the editor isn't in the build list yet
  return import.meta.env.DEV ? `/@photo/diary/${ENTRY_NAME}/uploads/${encodeURIComponent(name)}` : '';
}

const STICKY_COLORS = ['#fff59d', '#ffcc80', '#ff8a80', '#a5d6a7', '#90caf9', '#ce93d8'];
const TAPE_COLORS = ['#e6d6ac'];
const FONTS = { handwritten: '"Caveat", cursive', serif: '"Lora", serif', mono: '"Space Mono", monospace' };

// ---------- encryption (AES-GCM, key from PBKDF2 — same as the diary app) ----------

const PBKDF2_ITERATIONS = 200000;
const toBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const toBase64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));

async function deriveKey(password, salt) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// The decrypted { items, pages, canvasBg, canvasBgImage }, or null for a wrong password.
async function decrypt(password, enc) {
  try {
    const key = await deriveKey(password, toBytes(enc.salt));
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toBytes(enc.iv) }, key, toBytes(enc.data));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null;
  }
}

export async function encrypt(password, payload) {
  // chunked so a big payload doesn't overflow String.fromCharCode's arguments
  const b64 = (buf) => {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(payload)));
  return { v: 1, salt: toBase64(salt), iv: toBase64(iv), data: b64(data) };
}

// ---------- item cards (ported from the diary app's read-only view) ----------

function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, iframe, object, embed').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((node) => {
    [...node.attributes].forEach((attr) => {
      if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
      if ((attr.name === 'href' || attr.name === 'src') && /^\s*javascript:/i.test(attr.value)) node.removeAttribute(attr.name);
    });
  });
  return doc.body.innerHTML;
}

function styleText(item, el) {
  el.style.fontFamily = FONTS[item.font] || '';
  el.style.color = item.textColor || '';
  el.style.fontSize = item.fontSize ? `${item.fontSize}px` : '';
}

function setText(item, el) {
  if (item.richText) el.innerHTML = sanitizeHtml(item.text || '');
  else el.textContent = item.text || '';
  styleText(item, el);
}

function photoCard(item) {
  const img = document.createElement('img');
  img.src = imageUrl(item.img);
  img.alt = item.caption?.trim() || '';
  img.draggable = false;
  if (item.h) {
    img.style.height = `${item.h}px`;
    img.style.objectFit = item.frame === 'none' ? 'cover' : 'fill';
  }
  if (item.flipH || item.flipV) img.style.transform = `scale(${item.flipH ? -1 : 1}, ${item.flipV ? -1 : 1})`;
  if (item.frame === 'none') {
    img.className = 'plain-photo-img' + (item.shadow === false ? ' no-shadow' : '');
    return img;
  }
  const card = document.createElement('div');
  card.className = (item.frame === 'paper' ? 'paper-frame' : 'polaroid') + (item.shadow === false ? ' no-shadow' : '');
  const caption = document.createElement('div');
  caption.className = 'caption-input';
  caption.textContent = item.caption || '';
  styleText(item, caption);
  card.append(img, caption);
  return card;
}

function noteCard(item) {
  const card = document.createElement('div');
  const sticky = item.noteStyle === 'sticky';
  card.className = `note-card ${sticky ? 'note-style-sticky' : 'note-style-paper'}`;
  if (sticky) card.style.background = item.noteColor || STICKY_COLORS[0];
  const text = document.createElement('div');
  text.className = 'note-text';
  setText(item, text);
  card.append(text);
  return card;
}

function textCard(item) {
  const text = document.createElement('div');
  text.className = 'text-box';
  setText(item, text);
  return text;
}

function tapeCard(item) {
  const card = document.createElement('div');
  card.className = 'tape-card';
  const strip = document.createElement('div');
  strip.className = 'tape-strip';
  strip.style.backgroundColor = item.tapeColor || TAPE_COLORS[0];
  const text = document.createElement('div');
  text.className = 'tape-text';
  setText(item, text);
  strip.append(text);
  card.append(strip);
  return card;
}

// Two photos stacked, flipping back and forth forever.
function bangarangCard(item) {
  const frame = document.createElement('div');
  frame.className = 'bangarang-frame';
  if (item.h) frame.style.height = `${item.h}px`;
  const [a, b] = [item.img1, item.img2].map((src, i) => {
    const img = document.createElement('img');
    img.className = `bangarang-img${i ? ' bangarang-img-back' : ''}`;
    img.src = imageUrl(src);
    img.alt = '';
    img.draggable = false;
    return img;
  });
  frame.append(a, b);
  const delay = Math.min(1000, Math.max(30, Number(item.delay) || 150));
  let first = true;
  const timer = setInterval(() => {
    if (!frame.isConnected) return clearInterval(timer);
    first = !first;
    a.style.opacity = first ? '1' : '0';
    b.style.opacity = first ? '0' : '1';
  }, delay);
  return frame;
}

// The diary's music card. The site already has its own player, so this one
// shows the song and opens it on YouTube rather than playing inside the page.
function musicCard(item) {
  const card = document.createElement('a');
  card.className = 'yt-player-card';
  card.href = `https://www.youtube.com/watch?v=${encodeURIComponent(item.videoId || '')}`;
  card.target = '_blank';
  card.rel = 'noopener';
  card.innerHTML = `
    <div class="yt-header"><div class="yt-pill">Now Playing</div></div>
    <div class="yt-main">
      <div class="yt-art"><img alt="" /></div>
      <div class="yt-info"><div class="yt-title"></div><div class="yt-artist"></div></div>
    </div>
    <div class="yt-progress"><div class="yt-track"><div class="yt-fill"></div></div></div>
    <div class="yt-open">play on YouTube ↗</div>`;
  card.querySelector('img').src = item.thumb || `https://img.youtube.com/vi/${item.videoId}/hqdefault.jpg`;
  card.querySelector('.yt-title').textContent = item.title || '';
  card.querySelector('.yt-artist').textContent = item.artist || '';
  return card;
}

export function itemCard(item) {
  if (item.type === 'photo') return photoCard(item);
  if (item.type === 'youtube') return musicCard(item);
  if (item.type === 'text') return textCard(item);
  if (item.type === 'bangarang') return bangarangCard(item);
  if (item.type === 'tape') return tapeCard(item);
  return noteCard(item);
}

// A page's background, with its image (if any) pointed at the shrunk copy.
export const displayPage = (page) => (page?.bgImage ? { ...page, bgImage: imageUrl(page.bgImage) } : page);

// ---------- the book engine (public/diary-book/book.js + turn.js) ----------

let bookScript = null;
export function loadBookEngine() {
  bookScript ||= new Promise((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = 'diary-book/book.js';
    tag.onload = () => window.bookLoadLibs().then(resolve, reject);
    tag.onerror = () => reject(new Error("couldn't load the book"));
    document.head.append(tag);
  });
  return bookScript;
}

// ---------- the diary window ----------

const $ = (id) => document.getElementById(id);
const formatDate = (ts) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export function setupDiary() {
  const host = $('diary-book');
  let data = null; // the unlocked { items, pages, canvasBg, canvasBgImage }
  let password = null;
  let book = null;

  const status = (text) => {
    const count = data?.items?.length || 0;
    $('diary-status').textContent =
      text || (data ? `${formatDate(entry.date)} · ${count} item${count === 1 ? '' : 's'}` : `${formatDate(entry.date)} · protected`);
  };

  const availableHeight = () => host.clientHeight - 64;

  // the page the book is open at (so switching to / from the editor keeps your place)
  const openPage = () => (book ? Math.min(...book.view()) : 0);

  async function showBook(startPage = 0) {
    await loadBookEngine();
    book?.destroy();
    const pages = (data.pages?.length ? data.pages : window.bookNewPages()).map(displayPage);
    book = window.bookRenderReadOnly(host, { items: data.items, pages }, {
      cardBuilder: itemCard,
      snapshotBuilder: itemCard,
      availableHeight,
    });
    if (startPage) book.goTo(startPage);
    status();
  }

  async function startEditing() {
    if (!import.meta.env.DEV) return; // the live site is view-only (and doesn't ship the editor)
    const startPage = openPage();
    book?.destroy();
    book = null;
    $('diary-edit').hidden = true;
    const { startEditor } = await import('./diary-editor.js');
    book = await startEditor({
      host,
      data,
      password,
      entry,
      startPage,
      availableHeight,
      setStatus: status,
      onDone: (page) => {
        $('diary-edit').hidden = false;
        showBook(page);
      },
    });
  }

  $('diary-gate').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('diary-input');
    const button = $('diary-unlock');
    const error = $('diary-error');
    if (!input.value) return;
    if (!window.crypto?.subtle) {
      error.textContent = 'open the site over https to unlock'; // only https / localhost have WebCrypto
      error.hidden = false;
      return;
    }
    input.disabled = button.disabled = true;
    button.textContent = 'unlocking...';
    const page = await decrypt(input.value, entry.enc);
    input.disabled = button.disabled = false;
    button.textContent = 'unlock';
    if (!page) {
      const win = $('diary-window');
      win.classList.remove('is-shaking');
      void win.offsetWidth; // restart the shake
      win.classList.add('is-shaking');
      error.textContent = 'wrong password';
      error.hidden = false;
      input.value = '';
      input.focus();
      return;
    }
    password = input.value;
    input.value = '';
    data = { ...page, items: page.items || [] };
    $('diary-gate').hidden = true;
    host.hidden = false;
    if (import.meta.env.DEV) $('diary-edit').hidden = false;
    showBook();
  });

  $('diary-window').addEventListener('animationend', (e) => {
    if (e.animationName === 'shake') $('diary-window').classList.remove('is-shaking');
  });
  $('diary-edit').addEventListener('click', startEditing);
  $('diary-title').textContent = `${(entry.title || 'diary').trim().replace(/\s+/g, '-')}.diary`;
  status();

  // Called by the explorer icon.
  return function openDiary() {
    if (!data) {
      $('diary-gate').hidden = false;
      host.hidden = true;
      $('diary-error').hidden = true;
      $('diary-input').focus();
    } else {
      // the window may have been resized while the book was hidden
      window.dispatchEvent(new Event('resize'));
    }
  };
}
