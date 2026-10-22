import { build } from 'vite';
import { builtinModules } from 'node:module';
import { spawn } from 'node:child_process';
const external = new Set([...builtinModules, ...builtinModules.map(name => `node:${name}`)]);
await build({ configFile: false, build: { lib: { entry: 'scripts/telegram-preview.ts', formats: ['es'], fileName: 'preview' }, outDir: '.tmp-telegram-preview', rollupOptions: { external: id => external.has(id) } } });
const child = spawn(process.execPath, ['.tmp-telegram-preview/preview.js'], { stdio: 'inherit' });
process.on('SIGINT', () => child.kill());
child.on('exit', code => { process.exitCode = code ?? 0; });
