import { build, defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Keep the package and its adapter in one classic script: the opaque sandbox
// cannot load ES modules without granting it additional cross-origin access.
function editorFrame() {
  let root;
  async function compile() {
    const result = await build({
      configFile: false,
      root,
      publicDir: false,
      logLevel: 'warn',
      build: {
        write: false,
        emptyOutDir: false,
        lib: {
          entry: path.join(root, 'src/editor/frame.js'),
          name: 'WixNoteEditor',
          formats: ['iife'],
        },
      },
    });
    const output = (Array.isArray(result) ? result[0] : result).output;
    const entry = output.find((item) => item.type === 'chunk' && item.isEntry);
    if (!entry) throw new Error('WizEditor 构建未生成入口');
    return entry.code;
  }
  return {
    name: 'wiz-editor-frame',
    configResolved(config) {
      root = config.root;
    },
    async configureServer(server) {
      let compiled = compile();
      await compiled;
      server.middlewares.use('/editor/frame.js', async (_req, res, next) => {
        try {
          const script = await compiled;
          res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(script);
        } catch (error) {
          next(error);
        }
      });
      const directory = path.join(root, 'src/editor') + path.sep;
      server.watcher.on('change', (file) => {
        if (!path.resolve(file).startsWith(directory)) return;
        compiled = compile();
        // Keep a rejected compilation available to requests without leaving an
        // unhandled promise rejection while the developer fixes the source.
        compiled.catch((error) => server.config.logger.error(error.message));
        server.ws.send({ type: 'full-reload' });
      });
    },
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'editor/frame.js', source: await compile() });
    },
  };
}

export default defineConfig({
  plugins: [react(), editorFrame()],
  server: { proxy: { '/api': 'http://127.0.0.1:3000', '/files': 'http://127.0.0.1:3000' } },
  build: { chunkSizeWarningLimit: 1000 },
});
