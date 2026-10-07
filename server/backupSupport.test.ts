import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { makeDatabaseBackup } from './backupSupport.ts';

describe('database backup retention', () => {
  it('keeps seven dated copies, replaces same-day copies, and leaves unrelated files alone', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mecom-backup-'));
    try {
      await writeFile(join(dir, 'notes.txt'), 'keep');
      let version = 0;
      const db = { backup: async (path: string) => { await writeFile(path, `backup-${++version}`); } };
      for (let day = 1; day <= 9; day++) await makeDatabaseBackup(db, dir, new Date(Date.UTC(2026, 0, day)));
      await makeDatabaseBackup(db, dir, new Date(Date.UTC(2026, 0, 9)));
      const files = (await readdir(dir)).sort();
      expect(files).toHaveLength(8);
      expect(files).not.toContain('mecom-2026-01-02.sqlite');
      expect(files).toContain('mecom-2026-01-03.sqlite');
      expect(await readFile(join(dir, 'mecom-2026-01-09.sqlite'), 'utf8')).toBe('backup-10');
      expect(files.some(file => file.endsWith('.tmp'))).toBe(false);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('does not remove the last good copy when a replacement fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mecom-backup-'));
    try {
      const date = new Date('2026-01-01T00:00:00Z');
      await makeDatabaseBackup({ backup: async path => { await writeFile(path, 'good'); } }, dir, date);
      await expect(makeDatabaseBackup({ backup: async path => { await writeFile(path, 'partial'); throw new Error('failed'); } }, dir, date)).rejects.toThrow('failed');
      expect(await readFile(join(dir, 'mecom-2026-01-01.sqlite'), 'utf8')).toBe('good');
      expect(await readdir(dir)).toEqual(['mecom-2026-01-01.sqlite']);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
