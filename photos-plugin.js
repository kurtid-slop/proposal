// Shrinks the memories and fan-edit photos so they load fast and scroll smoothly
// (a phone photo is ~4000px wide; a film frame shows it at ~200px).
// Also converts HEIC photos to JPEG, since only Safari can show HEIC.
// `import url from './photo.heic?photo'` gives a URL to the small JPEG version.
// `import url from './photo.heic?photo-full'` gives the full-size original
// (HEIC as a full-size JPEG), used by the fan edit download button.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import convert from 'heic-convert';
import sharp from 'sharp';

const VARIANTS = {
  small: { query: '?photo', devPrefix: '/@photo/' },
  full: { query: '?photo-full', devPrefix: '/@photo-full/' },
};
const FOLDERS = ['memories', 'fan-edit'];
const isHeic = (file) => /\.hei[cf]$/i.test(file);
const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif' };
const CACHE_DIR = 'node_modules/.cache/photos';
const MAX_SIZE = 1000; // longest side in px; leaves room for zooming in with the crop editor
const QUALITY = 82;

// Converting is slow (~1s per HEIC), so results are cached on disk.
async function cachedJpeg(file, variant, make) {
  const { size, mtimeMs } = await fs.stat(file);
  const key = crypto
    .createHash('md5')
    .update(`${file}:${size}:${mtimeMs}:${variant}:${MAX_SIZE}:${QUALITY}`)
    .digest('hex');
  const cached = path.join(CACHE_DIR, `${key}.jpg`);
  try {
    return await fs.readFile(cached);
  } catch {}
  const jpeg = await make();
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(cached, jpeg);
  return jpeg;
}

const toSmallJpeg = (file) =>
  cachedJpeg(file, 'small', async () => {
    let input = await fs.readFile(file);
    if (isHeic(file)) {
      input = Buffer.from(await convert({ buffer: input, format: 'JPEG', quality: 0.95 }));
    }
    return sharp(input)
      .rotate() // apply the phone's orientation before stripping metadata
      .resize({ width: MAX_SIZE, height: MAX_SIZE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: QUALITY, mozjpeg: true })
      .toBuffer();
  });

// Full size: the original file as-is, except HEIC which becomes a full-size JPEG.
async function toFull(file) {
  if (!isHeic(file)) {
    const ext = path.extname(file).toLowerCase();
    return { source: await fs.readFile(file), ext, type: TYPES[ext] || 'application/octet-stream' };
  }
  const source = await cachedJpeg(file, 'full', async () =>
    Buffer.from(await convert({ buffer: await fs.readFile(file), format: 'JPEG', quality: 0.92 })),
  );
  return { source, ext: '.jpg', type: 'image/jpeg' };
}

async function loadVariant(file, variant) {
  if (variant === 'small') return { source: await toSmallJpeg(file), ext: '.jpg', type: 'image/jpeg' };
  return toFull(file);
}

export default function photos() {
  let config;
  return {
    name: 'memories-photos',
    enforce: 'pre',
    configResolved(c) {
      config = c;
    },
    async load(id) {
      const variant = Object.keys(VARIANTS).find((v) => id.endsWith(VARIANTS[v].query));
      if (!variant) return;
      const file = id.slice(0, -VARIANTS[variant].query.length);
      if (config.command === 'build') {
        const { source, ext } = await loadVariant(file, variant);
        const ref = this.emitFile({
          type: 'asset',
          name: `${path.basename(file, path.extname(file))}${variant === 'full' ? '-full' : ''}${ext}`,
          source,
        });
        return `export default import.meta.ROLLUP_FILE_URL_${ref};`;
      }
      const rel = path.relative(config.root, file).split(path.sep).map(encodeURIComponent).join('/');
      return `export default ${JSON.stringify(VARIANTS[variant].devPrefix + rel)};`;
    },
    configureServer(server) {
      for (const [variant, { devPrefix }] of Object.entries(VARIANTS)) {
        server.middlewares.use(devPrefix, async (req, res, next) => {
          const file = path.resolve(config.root, decodeURIComponent(req.url.slice(1).split('?')[0]));
          if (!FOLDERS.some((dir) => file.startsWith(path.join(config.root, dir) + path.sep))) return next();
          try {
            const { source, type } = await loadVariant(file, variant);
            res.setHeader('Content-Type', type);
            res.setHeader('Cache-Control', 'no-cache');
            res.end(source);
          } catch (err) {
            next(err);
          }
        });
      }
    },
  };
}
