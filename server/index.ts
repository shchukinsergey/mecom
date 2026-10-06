import { join } from 'node:path';
import { JsonRepository } from './repository.ts';
import { createLocalServer, listenLocal } from './http.ts';

const port = Number(process.env.MECOM_SERVER_PORT ?? 8790);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('MECOM_SERVER_PORT must be an integer from 0 to 65535');
const dataPath = process.env.MECOM_DATA_FILE ?? join(process.cwd(), 'data', 'server-state-v2.json');
const server = createLocalServer(new JsonRepository(dataPath));
await listenLocal(server, port);
const address = server.address();
console.log(`MECOM local server listening at http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}`);
