// Crop editor, only loaded while running `npm run dev`.
// Saves to memories/crops.json, which the live site reads.
import { applyCrop, DEFAULT_CROP, getCrop, isDefault, setCrop } from './crop.js';

const MAX_ZOOM = 3;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const round = (v, places) => Number(v.toFixed(places));

export function openCropEditor(photo, onSave) {
  let crop = getCrop(photo.name);

  const overlay = document.createElement('div');
  overlay.className = 'crop-editor';
  overlay.innerHTML = `
    <section class="window crop-editor__window" role="dialog" aria-label="Crop photo">
      <header class="window__bar">
        <span class="window__title"></span>
        <button class="window__close" type="button" aria-label="Close">x</button>
      </header>
      <div class="crop-editor__view"><img alt="" draggable="false" /></div>
      <div class="crop-editor__controls">
        <label class="crop-editor__zoom">zoom
          <input type="range" min="1" max="${MAX_ZOOM}" step="0.01" />
        </label>
        <button class="btn" type="button" data-action="rotate">rotate</button>
        <button class="btn" type="button" data-action="reset">reset</button>
        <button class="btn" type="button" data-action="cancel">cancel</button>
        <button class="btn btn--primary" type="button" data-action="save">save</button>
      </div>
      <footer class="window__status">drag to move · scroll or slider to zoom · rotate turns 90°</footer>
    </section>`;

  const q = (sel) => overlay.querySelector(sel);
  const view = q('.crop-editor__view');
  const img = q('.crop-editor__view img');
  const slider = q('input[type="range"]');
  q('.window__title').textContent = `crop - ${photo.name}`;
  img.src = photo.url;

  const render = () => {
    applyCrop(img, crop);
    slider.value = crop.zoom;
  };

  // How far (px) the photo can slide in each direction at the current zoom,
  // measured along the photo's own (unrotated) axes.
  const panRange = () => {
    const turned = crop.rotate % 180 !== 0;
    const w = turned ? view.clientHeight : view.clientWidth;
    const h = turned ? view.clientWidth : view.clientHeight;
    const cover = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    return [crop.zoom * img.naturalWidth * cover - w, crop.zoom * img.naturalHeight * cover - h];
  };

  let drag = null;
  view.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, start: { ...crop } };
    view.setPointerCapture(e.pointerId);
  });
  view.addEventListener('pointermove', (e) => {
    if (!drag || !img.naturalWidth) return;
    const [rx, ry] = panRange();
    // Turn the on-screen drag into the photo's own direction when it's rotated.
    const a = (crop.rotate * Math.PI) / 180;
    const sx = e.clientX - drag.x;
    const sy = e.clientY - drag.y;
    const dx = sx * Math.cos(a) + sy * Math.sin(a);
    const dy = -sx * Math.sin(a) + sy * Math.cos(a);
    crop = {
      ...crop,
      x: rx > 0 ? round(clamp(drag.start.x - (dx / rx) * 100, 0, 100), 1) : crop.x,
      y: ry > 0 ? round(clamp(drag.start.y - (dy / ry) * 100, 0, 100), 1) : crop.y,
    };
    render();
  });
  const endDrag = () => (drag = null);
  view.addEventListener('pointerup', endDrag);
  view.addEventListener('pointercancel', endDrag);

  view.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      crop = { ...crop, zoom: round(clamp(crop.zoom * Math.exp(-e.deltaY * 0.002), 1, MAX_ZOOM), 2) };
      render();
    },
    { passive: false },
  );
  slider.addEventListener('input', () => {
    crop = { ...crop, zoom: Number(slider.value) };
    render();
  });

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);

  const save = async (button) => {
    button.disabled = true;
    try {
      const res = await fetch('/__crops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: photo.name, crop: isDefault(crop) ? null : crop }),
      });
      if (!res.ok) throw new Error(await res.text());
      setCrop(photo.name, crop);
      onSave();
      close();
    } catch (err) {
      alert(`Couldn't save the crop: ${err.message}`);
      button.disabled = false;
    }
  };

  q('.window__close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
    const action = e.target.dataset?.action;
    if (action === 'cancel') close();
    if (action === 'rotate') {
      crop = { ...crop, rotate: (crop.rotate + 90) % 360 };
      render();
    }
    if (action === 'reset') {
      crop = { ...DEFAULT_CROP };
      render();
    }
    if (action === 'save') save(e.target);
  });

  render();
  document.body.append(overlay);
}
