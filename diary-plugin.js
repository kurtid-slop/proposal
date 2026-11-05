// Dev-only endpoints for the diary editor (npm run dev): save the
// (re-encrypted) entry and new photo uploads into /diary/<entry>/.
// The live site has none of this, so it's view-only.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

function readBody(req, limit = 40 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) reject(new Error('too large'));
      else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default function diary() {
  let root;
  // only plain folder names, so a request can't write outside /diary
  const entryDir = (name) => {
    if (!/^[a-z0-9-]+$/i.test(name || '')) throw new Error('bad entry name');
    return path.join(root, 'diary', name);
  };

  return {
    name: 'diary-editor-save',
    apply: 'serve',
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      // POST /__diary/save?entry=<name>  body: the whole entry.json
      server.middlewares.use('/__diary/save', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        try {
          const dir = entryDir(new URL(req.url, 'http://x').searchParams.get('entry'));
          const entry = JSON.parse((await readBody(req)).toString('utf8'));
          if (!entry.locked || !entry.enc?.data) throw new Error('refusing to save an unencrypted entry');
          await fs.writeFile(path.join(dir, 'entry.json'), `${JSON.stringify(entry, null, 2)}\n`);
          res.end('ok');
        } catch (err) {
          res.statusCode = 400;
          res.end(String(err.message || err));
        }
      });

      // POST /__diary/upload?entry=<name>  body: the image file  -> its new file name
      server.middlewares.use('/__diary/upload', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        try {
          const dir = entryDir(new URL(req.url, 'http://x').searchParams.get('entry'));
          const ext = IMAGE_TYPES[req.headers['content-type']];
          if (!ext) throw new Error('only jpg, png, webp or gif images');
          const name = `${crypto.randomUUID()}${ext}`;
          await fs.mkdir(path.join(dir, 'uploads'), { recursive: true });
          await fs.writeFile(path.join(dir, 'uploads', name), await readBody(req));
          res.end(name);
        } catch (err) {
          res.statusCode = 400;
          res.end(String(err.message || err));
        }
      });
    },
    // Saving shouldn't reload the page mid-edit; the editor already shows the change.
    handleHotUpdate({ file }) {
      if (path.resolve(file).startsWith(path.join(root, 'diary') + path.sep)) return [];
    },
  };
}
