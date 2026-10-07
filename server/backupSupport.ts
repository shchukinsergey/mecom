import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

interface BackupDatabase { backup(destination: string): Promise<void>; }
const BACKUP_PATTERN = /^mecom-\d{4}-\d{2}-\d{2}\.sqlite$/;

/** SQLite's online backup API is required; copying a live WAL database is not safe. */
export async function makeDatabaseBackup(database: BackupDatabase, directory: string, now = new Date()): Promise<void> {
  await mkdir(directory, { recursive: true });
  const target = join(directory, `mecom-${now.toISOString().slice(0, 10)}.sqlite`);
  const temporary = `${target}.tmp`;
  try {
    await database.backup(temporary);
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
  const files = (await readdir(directory)).filter(name => BACKUP_PATTERN.test(name)).sort().reverse();
  await Promise.all(files.slice(7).map(name => rm(join(directory, name), { force: true })));
}

/** One copy on startup and daily thereafter, retaining the latest seven dated copies. */
export function startDatabaseBackups(database: BackupDatabase, directory: string): () => Promise<void> {
  let inFlight: Promise<void> | null = null;
  const run = () => {
    if (inFlight) return;
    inFlight = makeDatabaseBackup(database, directory)
      .catch(() => { console.error('Database backup failed; check storage permissions and free space.'); })
      .finally(() => { inFlight = null; });
  };
  run();
  const timer = setInterval(run, 24 * 60 * 60 * 1000);
  timer.unref();
  return async () => { clearInterval(timer); await inFlight; };
}
