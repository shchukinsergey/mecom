import { join } from 'node:path';
import { JsonRepository } from './repository.ts';
import { createLocalServer, listenLocal } from './http.ts';
import { RoomDatabase } from './roomDatabase.ts';
import { createAccountServer, listenAccounts } from './roomsHttp.ts';
import { startDatabaseBackups } from './backupSupport.ts';

const port = Number(process.env.PORT ?? process.env.MECOM_SERVER_PORT ?? 8787);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Server port must be an integer from 0 to 65535');

if (process.env.MECOM_MODE === 'legacy') {
  // The old facilitator-token workflow remains explicitly opt-in and loopback-only.
  const dataPath = process.env.MECOM_DATA_FILE ?? join(process.cwd(), 'data', 'server-state.json');
  const server = createLocalServer(new JsonRepository(dataPath));
  await listenLocal(server, port);
  console.log(`MECOM legacy local server listening on port ${port}`);
} else {
  const production = process.env.NODE_ENV === 'production';
  const dataDirectory = process.env.MECOM_DATA_DIR ?? join(process.cwd(), 'data');
  const database = new RoomDatabase(join(dataDirectory, 'mecom.sqlite'));
  const server = createAccountServer(database, {
    secureCookies: production,
    publicOrigin: process.env.MECOM_PUBLIC_ORIGIN,
  });
  try {
    await listenAccounts(server, port, production ? '0.0.0.0' : '127.0.0.1');
  } catch (error) {
    database.close();
    throw error;
  }
  const stopBackups = startDatabaseBackups(database, join(dataDirectory, 'backups'));
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    const forceClose = setTimeout(() => server.closeAllConnections(), 10_000);
    forceClose.unref();
    await new Promise<void>(resolve => server.close(() => resolve()));
    clearTimeout(forceClose);
    await stopBackups();
    database.close();
  };
  process.once('SIGTERM', () => { void stop().catch(() => { process.exitCode = 1; }); });
  process.once('SIGINT', () => { void stop().catch(() => { process.exitCode = 1; }); });
  const address = server.address();
  const boundPort = address && typeof address !== 'string' ? address.port : port;
  console.log(`MECOM account server listening on port ${boundPort}`);
}
