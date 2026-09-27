// "memories-fanedit.exe": Instagram-style posts you swipe through.
// ✏️ Put the photos in the /fan-edit folder at the project root.
// They're shown in filename order (01.jpg, 02.jpg, ...). HEIC works too.
import { saveImage } from './save-image.js';

const files = import.meta.glob(
  '/fan-edit/*.{jpg,jpeg,png,webp,avif,heic,heif,JPG,JPEG,PNG,WEBP,AVIF,HEIC,HEIF}',
  { eager: true, query: '?photo', import: 'default' },
);
// Full-size originals for the download button (HEIC saved as a full-size JPEG).
// Only fetched when the button is pressed.
const fullFiles = import.meta.glob(
  '/fan-edit/*.{jpg,jpeg,png,webp,avif,heic,heif,JPG,JPEG,PNG,WEBP,AVIF,HEIC,HEIF}',
  { eager: true, query: '?photo-full', import: 'default' },
);
const posts = Object.entries(files)
  .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
  .map(([file, url]) => ({ name: file.split('/').pop(), url, full: fullFiles[file] }));

// Name the saved file after the original, with .jpg for converted HEICs.
const downloadName = (name) => name.replace(/\.hei[cf]$/i, '.jpg');

const MAX_DOTS = 15; // more posts than this: just show "3 / 20"
const SWIPE = 50; // px a swipe has to travel to change post

const $ = (id) => document.getElementById(id);

export function setupFanEdit() {
  const viewport = $('fan-viewport');
  const track = $('fan-track');
  let index = 0;

  const slides = posts.map((post) => {
    const slide = document.createElement('div');
    slide.className = 'fan__slide';
    const img = document.createElement('img');
    img.alt = post.name;
    img.draggable = false;
    img.decoding = 'async';
    img.dataset.src = post.url;
    slide.append(img);
    track.append(slide);
    return img;
  });

  const dots = posts.length <= MAX_DOTS ? posts.map(() => document.createElement('i')) : [];
  $('fan-dots').append(...dots);
  $('fan-empty').hidden = posts.length > 0;

  const show = (i, animate = true) => {
    index = Math.max(0, Math.min(posts.length - 1, i));
    // only load the current post and its neighbours
    for (const j of [index - 1, index, index + 1]) {
      const img = slides[j];
      if (img && !img.src) img.src = img.dataset.src;
    }
    track.style.transition = animate ? '' : 'none';
    track.style.transform = `translateX(${-index * 100}%)`;
    dots.forEach((dot, j) => dot.classList.toggle('is-active', j === index));
    $('fan-count').textContent = posts.length ? `${index + 1} / ${posts.length}` : '';
    $('fan-download').disabled = !posts.length;
    $('fan-prev').disabled = index === 0;
    $('fan-next').disabled = index >= posts.length - 1;
  };

  // Download the current post at full size.
  const download = $('fan-download');
  download.addEventListener('click', () => {
    const post = posts[index];
    if (post) saveImage(post.full, downloadName(post.name), download);
  });

  $('fan-prev').addEventListener('click', () => show(index - 1));
  $('fan-next').addEventListener('click', () => show(index + 1));

  // Swipe left = next, swipe right = previous. The post follows the finger.
  let drag = null;
  viewport.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button') || !posts.length) return;
    drag = { x: e.clientX, dx: 0, t: e.timeStamp };
    viewport.setPointerCapture(e.pointerId);
    track.style.transition = 'none';
  });
  viewport.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.dx = e.clientX - drag.x;
    const atEdge = (index === 0 && drag.dx > 0) || (index === posts.length - 1 && drag.dx < 0);
    const dx = atEdge ? drag.dx / 3 : drag.dx; // resist past the first / last post
    track.style.transform = `translateX(calc(${-index * 100}% + ${dx}px))`;
  });
  const end = (e) => {
    if (!drag) return;
    const { dx, t } = drag;
    drag = null;
    const quickFlick = Math.abs(dx) > 20 && e.timeStamp - t < 250;
    if (dx < -SWIPE || (quickFlick && dx < 0)) show(index + 1);
    else if (dx > SWIPE || (quickFlick && dx > 0)) show(index - 1);
    else show(index);
  };
  viewport.addEventListener('pointerup', end);
  viewport.addEventListener('pointercancel', end);

  document.addEventListener('keydown', (e) => {
    if ($('fan-screen').hidden) return;
    if (e.key === 'ArrowRight') show(index + 1);
    if (e.key === 'ArrowLeft') show(index - 1);
  });

  // Called by the folder icon: always starts from the first post.
  return function openFanEdit() {
    show(0, false);
  };
}
