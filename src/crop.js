// Per-photo crop settings, saved by the crop editor (npm run dev → click a photo).
// x / y: which part of the photo to focus on, 0–100 (%). zoom: 1 = fill the frame.
// rotate: 0, 90, 180 or 270 (degrees clockwise).
import crops from '/memories/crops.json';

export const DEFAULT_CROP = { x: 50, y: 50, zoom: 1, rotate: 0 };

// Width / height of the photo window in the film frame (and the crop editor preview).
const RATIO = 28 / 18.4;

export const getCrop = (name) => ({ ...DEFAULT_CROP, ...crops[name] });

export function setCrop(name, crop) {
  if (isDefault(crop)) delete crops[name];
  else crops[name] = crop;
}

export const isDefault = (crop) =>
  crop.x === DEFAULT_CROP.x &&
  crop.y === DEFAULT_CROP.y &&
  crop.zoom === DEFAULT_CROP.zoom &&
  crop.rotate === DEFAULT_CROP.rotate;

// object-position picks the focus point; scaling around that same point zooms into it.
// For 90° / 270° the image box is swapped to tall-and-narrow, so after turning it
// still exactly covers the window.
export function applyCrop(img, crop) {
  const { x, y, zoom, rotate } = crop;
  const turned = rotate % 180 !== 0;
  img.style.width = turned ? `${100 / RATIO}%` : '';
  img.style.height = turned ? `${100 * RATIO}%` : '';
  img.style.left = turned ? `${(100 - 100 / RATIO) / 2}%` : '';
  img.style.top = turned ? `${(100 - 100 * RATIO) / 2}%` : '';
  img.style.objectPosition = `${x}% ${y}%`;

  const transforms = [];
  if (rotate) transforms.push(`rotate(${rotate}deg)`);
  if (zoom !== 1) transforms.push(`translate(${x - 50}%, ${y - 50}%) scale(${zoom}) translate(${50 - x}%, ${50 - y}%)`);
  img.style.transform = transforms.join(' ');
}
