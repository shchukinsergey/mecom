import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { JsonRepository, type RepositoryState } from './repository.ts';

let dir = '';
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); dir = ''; });

describe('JsonRepository', () => {
  it('starts empty, persists replacement, and reloads JSON', async () => {
    dir = await mkdtemp(join(tmpdir(), 'mecom-repo-'));
    const file = join(dir, 'state.json');
    const repo = new JsonRepository(file);
    expect(await repo.read()).toEqual({ schemaVersion: 1, leagues: {}, games: {} });
    const data: RepositoryState = { schemaVersion: 1, leagues: { abc: { value: 42 } }, games: {} };
    await repo.write(data);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(data);
    expect(await new JsonRepository(file).read()).toEqual(data);
  });

  it('migrates persisted legacy state by adding an empty games map', async () => {
    dir = await mkdtemp(join(tmpdir(), 'mecom-repo-'));
    const file = join(dir, 'legacy.json');
    const legacy = { schemaVersion: 1, leagues: { old: { value: 1 } } };
    await import('node:fs/promises').then(({ writeFile }) => writeFile(file, JSON.stringify(legacy)));
    expect(await new JsonRepository(file).read()).toEqual({ ...legacy, games: {} });
  });
});
