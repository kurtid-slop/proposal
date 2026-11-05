// Diary book editor — only loaded while running `npm run dev`.
// Core editing like the Scrapbook Diary app: drag items (onto other pages too),
// rotate, resize, delete, edit text, add photos / notes / text, add or remove
// pages. Every change autosaves: the entry is re-encrypted with its password
// and written to /diary/<entry>/entry.json (push to publish).
import { displayPage, ENTRY_NAME, encrypt, itemCard, loadBookEngine } from './diary.js';

const WASHI_COLORS = ['#c9a15a', '#9b7fa6', '#8c9b74', '#c98a6b', '#7fa0b0', '#d4a3b5'];
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const EDITABLE = '.note-text, .text-box, .caption-input, .tape-text';
// Same limits as public/diary-book/book.js (its top-level consts aren't on window).
const BOOK_ITEM_MIN = -45; // how far past a page edge an item's center may go, in %
const BOOK_ITEM_MAX = 145;
const BOOK_MIN_PAGE_COUNT = 6; // 2 covers + their insides + at least 2 pages

export async function startEditor({ host, data, password, entry, startPage = 0, availableHeight, setStatus, onDone }) {
  await loadBookEngine();
  const B = window; // book.js's functions are globals
  if (!Array.isArray(data.pages) || data.pages.length < BOOK_MIN_PAGE_COUNT) data.pages = B.bookNewPages();

  let book = null;
  let selectedId = null;
  const wraps = new Map(); // item id -> wrap element

  // ---------- saving ----------

  let saveTimer = 0;
  let saving = Promise.resolve();
  let dirty = false; // a change is waiting to be saved
  function scheduleSave() {
    dirty = true;
    setStatus('unsaved changes…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => (saving = saving.then(save)), 600);
  }
  async function save() {
    dirty = false;
    try {
      const enc = await encrypt(password, {
        items: data.items,
        canvasBg: data.canvasBg,
        canvasBgImage: data.canvasBgImage,
        pages: data.pages,
      });
      const next = { ...entry, items: [], locked: true, enc, pages: null };
      const res = await fetch(`/__diary/save?entry=${ENTRY_NAME}`, { method: 'POST', body: JSON.stringify(next) });
      if (!res.ok) throw new Error(await res.text());
      entry.enc = enc; // so a later re-open decrypts the saved version
      setStatus(`saved · ${data.items.length} items`);
    } catch (err) {
      setStatus(`couldn't save: ${err.message}`);
    }
  }

  // ---------- rendering ----------

  const itemById = (id) => data.items.find((it) => it.id === id);
  const pageCount = () => data.pages.length;

  function createWrap(item) {
    const wrap = document.createElement('div');
    wrap.className = 'sb-item diary-edit-item';
    wrap.dataset.id = item.id;
    wrap.addEventListener('pointerdown', (e) => onItemPointerDown(e, item.id));
    wrap.addEventListener('dblclick', () => startTextEdit(item.id));
    fillWrap(wrap, item);
    return wrap;
  }

  // (Re)build the wrap's contents: washi tape, the card, and the selection handles.
  function fillWrap(wrap, item) {
    wrap.replaceChildren();
    if (item.type !== 'text' && item.type !== 'tape' && !(item.type === 'photo' && item.tape === false)) {
      const washi = document.createElement('div');
      washi.className = 'washi';
      washi.style.background = item.color;
      wrap.append(washi);
    }
    wrap.append(itemCard(item));
    for (const [cls, label, title] of [
      ['delete', '×', 'Delete'],
      ['rotate', '⟳', 'Rotate'],
      ['resize', '◢', 'Resize'],
    ]) {
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = `diary-handle diary-handle--${cls}`;
      handle.textContent = label;
      handle.title = title;
      handle.dataset.handle = cls;
      wrap.append(handle);
    }
  }

  function placeWrap(wrap, item) {
    wrap.style.left = `${item.x}%`;
    wrap.style.top = `${item.y}%`;
    wrap.style.width = `${item.w}px`;
    wrap.style.zIndex = item.z;
    wrap.style.transform = `translate(-50%, -50%) rotate(${item.rot || 0}deg)`;
    const selected = item.id === selectedId;
    wrap.classList.toggle('is-selected', selected);
    // cut off at the page edge like the published book, except while selected (so the handles show)
    wrap.style.clipPath = !selected && item.overflow !== 'out' ? B.bookItemClipPath(item) : '';
  }

  function render() {
    const ids = new Set(data.items.map((it) => it.id));
    for (const [id, wrap] of wraps) {
      if (!ids.has(id)) {
        wrap.remove();
        wraps.delete(id);
      }
    }
    for (const item of data.items) {
      let wrap = wraps.get(item.id);
      if (!wrap) wraps.set(item.id, (wrap = createWrap(item)));
      const container = book.pageInner(B.bookPageOf(item, pageCount()));
      if (wrap.parentNode !== container) container.append(wrap);
      placeWrap(wrap, item);
    }
    const sel = selectedId && itemById(selectedId);
    book.raisePage(sel ? B.bookPageOf(sel, pageCount()) : null);
  }

  function select(id) {
    if (selectedId === id) return;
    if (selectedId) stopTextEdit();
    selectedId = id;
    render();
  }

  // ---------- drag / rotate / resize ----------

  function onItemPointerDown(e, id) {
    if (e.button !== 0) return;
    const item = itemById(id);
    const wrap = wraps.get(id);
    if (!item || !wrap) return;
    if (e.target.isContentEditable) return; // typing in it
    e.stopPropagation();
    e.preventDefault();
    select(id);
    item.z = Math.max(0, ...data.items.map((it) => it.z || 0)) + 1;
    placeWrap(wrap, item);

    const handle = e.target.dataset?.handle;
    if (handle === 'delete') {
      data.items = data.items.filter((it) => it.id !== id);
      selectedId = null;
      render();
      return scheduleSave();
    }

    const startX = e.clientX;
    const startY = e.clientY;
    const start = { ...item };
    const box = wrap.getBoundingClientRect();
    const center = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const startDist = Math.hypot(startX - center.x, startY - center.y) || 1;
    const pageRect = book.pageInner(B.bookPageOf(item, pageCount())).getBoundingClientRect();
    let moved = false;

    // a page that isn't laid out measures 0 — never turn that into a bad position
    if (!pageRect.width || !pageRect.height) return;

    const onMove = (ev) => {
      moved = true;
      if (handle === 'rotate') {
        let deg = (Math.atan2(ev.clientY - center.y, ev.clientX - center.x) * 180) / Math.PI + 90;
        deg = ((deg + 540) % 360) - 180;
        item.rot = Math.abs(deg) < 3 ? 0 : Math.round(deg * 10) / 10; // snap upright
      } else if (handle === 'resize') {
        const f = Math.hypot(ev.clientX - center.x, ev.clientY - center.y) / startDist;
        item.w = Math.round(clamp(start.w * f, 40, 900));
        if (start.h) item.h = Math.round(clamp(start.h * f, 30, 1200));
      } else {
        item.x = clamp(start.x + ((ev.clientX - startX) / pageRect.width) * 100, BOOK_ITEM_MIN, BOOK_ITEM_MAX);
        item.y = clamp(start.y + ((ev.clientY - startY) / pageRect.height) * 100, BOOK_ITEM_MIN, BOOK_ITEM_MAX);
      }
      placeWrap(wrap, item);
      if (handle === 'resize' && start.h) fillWrap(wrap, item); // photo height lives on the card
    };

    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (!moved) return;
      // dropped on the other open page: move it there
      if (!handle) {
        const target = book.pointToPage(ev.clientX, ev.clientY);
        const fromPage = B.bookPageOf(item, pageCount());
        if (target && target.page !== fromPage) {
          // keep the same spot of the item under the pointer
          const grabX = ((startX - center.x) / pageRect.width) * 100;
          const grabY = ((startY - center.y) / pageRect.height) * 100;
          if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) return render();
          item.page = target.page;
          item.x = clamp(target.x - grabX, BOOK_ITEM_MIN, BOOK_ITEM_MAX);
          item.y = clamp(target.y - grabY, BOOK_ITEM_MIN, BOOK_ITEM_MAX);
        }
      }
      render();
      scheduleSave();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // ---------- text editing (double-click a note, text box, caption or tape) ----------

  let editingEl = null;
  function startTextEdit(id) {
    const item = itemById(id);
    const el = wraps.get(id)?.querySelector(EDITABLE);
    if (!item || !el) return;
    select(id);
    editingEl = el;
    editingEl.contentEditable = 'true';
    editingEl.focus();
    document.getSelection()?.selectAllChildren(editingEl);
    editingEl.addEventListener(
      'input',
      () => {
        if (editingEl.classList.contains('caption-input')) item.caption = editingEl.innerText;
        else if (item.richText) item.text = editingEl.innerHTML;
        else item.text = editingEl.innerText;
        scheduleSave();
      },
      { signal: textEditAbort().signal },
    );
  }
  let textAbort = null;
  function textEditAbort() {
    textAbort?.abort();
    textAbort = new AbortController();
    return textAbort;
  }
  function stopTextEdit() {
    if (!editingEl) return;
    editingEl.contentEditable = 'false';
    editingEl = null;
    textAbort?.abort();
  }

  // ---------- adding items ----------

  function addItem(fields) {
    const pos = book.centerPos();
    const item = {
      id: `${fields.type}-${Date.now()}`,
      x: pos.x,
      y: pos.y,
      rot: Math.round((Math.random() - 0.5) * 8 * 10) / 10,
      color: pick(WASHI_COLORS),
      z: Math.max(0, ...data.items.map((it) => it.z || 0)) + 1,
      page: pos.page,
      ...fields,
    };
    data.items.push(item);
    selectedId = item.id;
    render();
    scheduleSave();
    return item;
  }

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/jpeg,image/png,image/webp,image/gif';
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    setStatus('uploading photo…');
    try {
      const res = await fetch(`/__diary/upload?entry=${ENTRY_NAME}`, {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!res.ok) throw new Error(await res.text());
      addItem({ type: 'photo', img: `uploads/${await res.text()}`, caption: '', w: 190 });
    } catch (err) {
      setStatus(`couldn't add photo: ${err.message}`);
    }
  });

  // ---------- pages (always two at a time, like the app) ----------

  function addPages() {
    const count = pageCount();
    const at = Math.min(count - 2, Math.max(2, Math.max(...book.view()) + 1));
    for (const item of data.items) {
      const page = B.bookPageOf(item, count);
      item.page = page >= at ? page + 2 : page;
    }
    data.pages.splice(at, 0, {}, {});
    rebuildPages(at);
  }

  function removePages() {
    const count = pageCount();
    const lastBlank = count - 3;
    if (count <= BOOK_MIN_PAGE_COUNT) return alert('A book needs at least two pages besides its covers.');
    const open = book.view().filter((i) => i >= 2 && i <= lastBlank);
    if (!open.length) return alert("Turn to the pages you'd like to remove first — covers can't be removed.");
    const first = Math.min(...open) + 1 > lastBlank ? Math.min(...open) - 1 : Math.min(...open);
    const doomed = data.items.filter((it) => [first, first + 1].includes(B.bookPageOf(it, count)));
    const names = `${B.bookPageName(first, count)} and ${B.bookPageName(first + 1, count)}`;
    const extra = doomed.length ? ` The ${doomed.length} item${doomed.length === 1 ? '' : 's'} on them will be deleted too.` : '';
    if (!confirm(`Remove ${names}?${extra}`)) return;
    data.items = data.items.filter((it) => !doomed.includes(it));
    for (const item of data.items) {
      const page = B.bookPageOf(item, count);
      item.page = page > first + 1 ? page - 2 : page;
    }
    data.pages.splice(first, 2);
    rebuildPages(Math.max(0, first - 1));
  }

  function rebuildPages(openAt) {
    for (const wrap of wraps.values()) wrap.remove();
    wraps.clear();
    book.setPageCount(pageCount(), openAt);
    render();
    scheduleSave();
  }

  // ---------- mount ----------

  book = B.bookCreate(host, {
    pageCount: pageCount(),
    startPage,
    editing: true,
    availableHeight,
    decoratePage: (pageEl, i) => B.bookApplyPageBackground(pageEl, displayPage(data.pages[i])),
    getItems: () => data.items,
    tabCardBuilder: itemCard,
    onSettle: () => render(),
  });
  host.classList.add('is-editing');

  const tools = document.createElement('span');
  tools.className = 'diary-tools';
  for (const [label, action] of [
    ['+ photo', () => fileInput.click()],
    ['+ note', () => addItem({ type: 'note', noteStyle: 'paper', text: 'new note', w: 180 })],
    ['+ text', () => addItem({ type: 'text', text: 'text', w: 200, font: 'handwritten', fontSize: 28 })],
    ['+ 2 pages', addPages],
    ['− 2 pages', removePages],
    ['done', finish],
  ]) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.textContent = label;
    btn.addEventListener('click', action);
    tools.append(btn);
  }
  book.navExtras.append(tools);

  // clicking empty page space deselects
  const onHostDown = (e) => {
    if (!e.target.closest('.diary-edit-item') && !e.target.closest('.book-nav')) select(null);
  };
  host.addEventListener('pointerdown', onHostDown);

  const onKey = (e) => {
    if (!selectedId || editingEl || !['Delete', 'Backspace'].includes(e.key)) return;
    if (e.target.closest?.('input, textarea')) return;
    data.items = data.items.filter((it) => it.id !== selectedId);
    selectedId = null;
    render();
    scheduleSave();
  };
  document.addEventListener('keydown', onKey);

  async function finish() {
    clearTimeout(saveTimer);
    if (dirty) saving = saving.then(save);
    await saving;
    document.removeEventListener('keydown', onKey);
    host.removeEventListener('pointerdown', onHostDown);
    host.classList.remove('is-editing');
    const page = Math.min(...book.view());
    book.destroy();
    onDone(page);
  }

  render();
  setStatus('editing · double-click text to change it');
  return book;
}
