import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Dev-only asset drop endpoint: POST /__save?name=<file> writes the request
 * body into public/rooms (images) or public/models (.glb). Used to deliver
 * AI-generated assets (Higgsfield/NanoBanana) straight into the project.
 * Strict filename whitelist; active only in `vite dev`.
 */
function assetDropPlugin() {
  return {
    name: 'asset-drop',
    configureServer(server) {
      server.middlewares.use('/__save', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end('POST only');
        }
        const name = new URL(req.url, 'http://localhost').searchParams.get('name') || '';
        if (!/^[a-z0-9_-]+\.(png|jpg|jpeg|glb)$/i.test(name)) {
          res.statusCode = 400;
          return res.end('bad name');
        }
        const dir = path.resolve(__dirname, 'public', name.endsWith('.glb') ? 'models' : 'rooms');
        fs.mkdirSync(dir, { recursive: true });
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const buf = Buffer.concat(chunks);
          fs.writeFileSync(path.join(dir, name), buf);
          res.end(`saved ${name} (${buf.length} bytes)`);
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), assetDropPlugin()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') },
    },
  },
});
