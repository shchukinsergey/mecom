import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.npm_execpath) throw new Error('Run this script with npm run package:amvera.');
const build = spawnSync(process.execPath, [process.env.npm_execpath, 'run', 'build'], { cwd: root, stdio: 'inherit' });
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);
const zip = new JSZip();
async function addDirectory(relative) {
  const entries = await readdir(join(root, relative), { withFileTypes: true });
  for (const entry of entries) {
    const path = `${relative}/${entry.name}`;
    if (entry.isDirectory()) await addDirectory(path);
    else if (entry.isFile()) zip.file(path, await readFile(join(root, path)));
    else throw new Error(`Refusing to package non-regular file: ${path}`);
  }
}
await addDirectory('dist');
await addDirectory('dist-server');
zip.file('amvera.yml', await readFile(join(root, 'amvera.yml')));
zip.file('DEPLOY-AMVERA.md', await readFile(join(root, 'DEPLOY-AMVERA.md')));
// The upload is prebuilt locally: no npm installation or TypeScript compilation on hosting.
zip.file('Dockerfile', `FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 MECOM_DATA_DIR=/data NODE_OPTIONS=--max-old-space-size=256
COPY dist ./dist
COPY dist-server ./dist-server
RUN mkdir -p /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist-server/index.js"]
`);
const output = join(root, 'releases', 'mecom-amvera.zip');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }));
console.log(`Amvera package: ${output}`);
console.log('Contains only the application build and deployment instructions; no user databases or credentials.');
