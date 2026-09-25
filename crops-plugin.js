// Dev-only endpoint the crop editor posts to; writes memories/crops.json.
import fs from 'node:fs/promises';
import path from 'node:path';

const FILE = 'memories/crops.json';

export default function crops() {
  let file;
  return {
    name: 'crop-editor-save',
    apply: 'serve',
    configResolved(config) {
      file = path.join(config.root, FILE);
    },
    configureServer(server) {
      server.middlewares.use('/__crops', (req, res, next) => {
        if (req.method !== 'POST') return next();
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', async () => {
          try {
            const { name, crop } = JSON.parse(body);
            const all = JSON.parse(await fs.readFile(file, 'utf8').catch(() => '{}'));
            if (crop) all[name] = crop;
            else delete all[name];
            const sorted = Object.fromEntries(
              Object.entries(all).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })),
            );
            await fs.writeFile(file, `${JSON.stringify(sorted, null, 2)}\n`);
            res.end('ok');
          } catch (err) {
            res.statusCode = 500;
            res.end(String(err));
          }
        });
      });
    },
    // Saving a crop shouldn't reload the page; the editor already applied it.
    handleHotUpdate({ file: changed }) {
      if (path.resolve(changed) === file) return [];
    },
  };
}
