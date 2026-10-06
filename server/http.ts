import { createHash, randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';

import { JsonRepository, validDecision } from './repository.ts';
import type { Game, Firm } from './repository.ts';
import type { LeagueSnapshot } from '../src/state/persistence.ts';
import type { League, PeriodMacroParams } from '../src/engine/types.ts';
import { makeFirmDecision, makeFirmStart, makeMacroParams, DEFAULT_LEAGUE_CONFIG } from '../src/engine/config.ts';
import { computePeriod, initialOpeningState, nextOpeningState } from '../src/engine/computePeriod.ts';
import { renderFirmExport } from '../src/report/index.ts';

const MAX_BODY_BYTES = 1_048_576;
const MAX_NAME = 100;
class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
const hash = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');
const secret = () => randomBytes(32).toString('base64url');
function secureMatch(given: string, stored: string): boolean { const a = Buffer.from(hash(given), 'hex'); const b = Buffer.from(stored, 'hex'); return a.length === b.length && timingSafeEqual(a, b); }

export function createLocalServer(repository: JsonRepository, config: string | { adminToken: string } | undefined = process.env.MECOM_ADMIN_TOKEN, webRoot = resolve(process.cwd(), 'dist')): Server {
  const adminToken = typeof config === 'object' && config !== null ? config.adminToken : config;
  if (typeof adminToken !== 'string' || Buffer.byteLength(adminToken, 'utf8') < 32) throw new Error('MECOM_ADMIN_TOKEN must be at least 32 bytes');
  return createServer((request, response) => {
    void handleRequest(request, response, repository, adminToken, webRoot).catch(error => {
      if (error instanceof ApiError) sendJson(response, error.status, { error: error.message });
      else if (typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 413) sendJson(response, 413, { error: 'Request body too large' });
      else sendJson(response, 500, { error: 'Internal server error' });
    });
  });
}
export async function listenLocal(server: Server, port = 8787): Promise<void> {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); }); });
}
async function handleRequest(req: IncomingMessage, res: ServerResponse, repo: JsonRepository, admin: string, webRoot: string): Promise<void> {
  const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  if (req.method === 'GET' && path === '/health') return sendJson(res, 200, { ok: true });
  if (req.method === 'GET' && path !== '/api' && !path.startsWith('/api/')) {
    if (await serveStatic(req, res, path, webRoot)) return;
  }

  if (path === '/api/state') {
    requireAdmin(req, admin);
    if (req.method === 'GET') return sendJson(res, 200, await repo.read());
    if (req.method !== 'PUT') throw new ApiError(405, 'Method not allowed');
    const state = await jsonBody(req);
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new ApiError(400, 'Invalid state');
    const candidate = state as Record<string, unknown>;
    if (candidate.schemaVersion !== 1 || !candidate.leagues || typeof candidate.leagues !== 'object' || Array.isArray(candidate.leagues)) {
      throw new ApiError(400, 'Invalid state');
    }
    // Legacy snapshots have no games map. Game data is managed by the game API,
    // so replacing a league snapshot must never erase online games or credentials.
    const current = await repo.read();
    await repo.write({ schemaVersion: 1, leagues: candidate.leagues as Record<string, unknown>, games: current.games });
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'POST' && path === '/api/games') {
    requireAdmin(req, admin); const body = await jsonBody(req); const name = readName(body, 'name');
    const source = body && typeof body === 'object' ? (body as Record<string, unknown>).snapshot : undefined;
    if (source !== undefined && !validSnapshot(source)) throw new ApiError(400, 'Invalid snapshot');
    const gameId = randomUUID(), inviteToken = secret();
    const snapshot = source ? freshSnapshot(source, gameId, name) : defaultSnapshot(gameId, name);
    await repo.update(state => { state.games[gameId] = { gameId, name, inviteTokenHash: hash(inviteToken), open: true, phase: 'lobby', firms: [], snapshot }; });
    return sendJson(res, 201, { gameId, name, inviteToken });
  }
  if (req.method === 'POST' && path === '/api/join') {
    const token = header(req, 'x-mecom-invite'); const body = await jsonBody(req); const firmName = readName(body, 'firmName');
    const result = await repo.update(state => {
      const game = Object.values(state.games).find(g => secureMatch(token, g.inviteTokenHash));
      if (!game) throw new ApiError(401, 'Invalid invite token'); if (!game.open || game.phase === 'collecting' || game.phase === 'complete' || game.phase === 'closed') throw new ApiError(409, 'Game lobby is closed');
      if (game.firms.length >= 12) throw new ApiError(409, 'Game is full');
      if (game.firms.some(f => f.firmName.trim().toLowerCase() === firmName.trim().toLowerCase())) throw new ApiError(409, 'Firm name already exists');
      const firmId = randomUUID(), rejoinToken = secret(); game.firms.push({ firmId, firmName: firmName.trim(), rejoinTokenHash: hash(rejoinToken), decision: null, submitted: false });
      return { gameId: game.gameId, firmId, firmName: firmName.trim(), rejoinToken };
    }); return sendJson(res, 201, result);
  }
  if (req.method === 'GET' && path === '/api/player/me') {
    const found = findPlayer(repo, header(req, 'x-mecom-player')); const { game, firm } = await found;
    return sendJson(res, 200, playerDto(game, firm));
  }
  if (req.method === 'PUT' && path === '/api/player/decision') {
    const token = header(req, 'x-mecom-player'), decision = await jsonBody(req); if (!validDecision(decision)) throw new ApiError(400, 'Invalid decision');
    await repo.update(state => { const { game, firm } = findPlayerInState(state, token); if (game.phase === 'closed') throw new ApiError(409, 'Game is closed'); if (game.phase === 'complete') throw new ApiError(409, 'Game is complete'); if (game.phase === 'lobby' && game.snapshot) throw new ApiError(409, 'Game has not started'); firm.decision = decision; firm.submitted = false; }); return sendJson(res, 200, { ok: true });
  }
  if (req.method === 'POST' && path === '/api/player/submit') {
    const token = header(req, 'x-mecom-player'); await repo.update(state => { const { game, firm } = findPlayerInState(state, token); if (game.phase === 'closed') throw new ApiError(409, 'Game is closed'); if (game.phase === 'lobby' && game.snapshot) throw new ApiError(409, 'Game has not started'); if (game.phase === 'complete') throw new ApiError(409, 'Game is complete'); if (!firm.decision) throw new ApiError(409, 'Save a decision before submitting'); firm.submitted = true; }); return sendJson(res, 200, { ok: true });
  }
  const statusMatch = path.match(/^\/api\/games\/([^/]+)\/status$/);
  if (req.method === 'GET' && statusMatch) {
    const token = header(req, 'x-mecom-player'); const state = await repo.read(); const { game: own } = findPlayerInState(state, token); if (own.gameId !== statusMatch[1]) throw new ApiError(403, 'Player token belongs to another game');
    return sendJson(res, 200, { gameId: own.gameId, phase: own.phase ?? (own.open ? 'lobby' : 'collecting'), currentPeriodIndex: own.snapshot?.league.results.length ?? 0, firms: own.firms.map(f => ({ firmId: f.firmId, firmName: f.firmName, submitted: f.submitted })) });
  }
  const adminGameMatch = path.match(/^\/api\/admin\/games\/([^/]+)$/);
  if (req.method === 'GET' && adminGameMatch) { requireAdmin(req, admin); const g = (await repo.read()).games[adminGameMatch[1]]; if (!g) throw new ApiError(404, 'Game not found'); return sendJson(res, 200, adminDto(g)); }
  const rotateMatch = path.match(/^\/api\/admin\/games\/([^/]+)\/firms\/([^/]+)\/rejoin-token$/);
  if (req.method === 'POST' && rotateMatch) { requireAdmin(req, admin); const token = secret(); await repo.update(s => { const g = s.games[rotateMatch[1]], f = g?.firms.find(x => x.firmId === rotateMatch[2]); if (!f) throw new ApiError(404, 'Firm not found'); f.rejoinTokenHash = hash(token); }); return sendJson(res, 200, { rejoinToken: token }); }
  const kickMatch = path.match(/^\/api\/admin\/games\/([^/]+)\/firms\/([^/]+)$/);
  if (req.method === 'DELETE' && kickMatch) {
    requireAdmin(req, admin);
    await repo.update(state => {
      const game = state.games[kickMatch[1]];
      if (!game) throw new ApiError(404, 'Game not found');
      if (game.phase === 'complete' || game.phase === 'closed') throw new ApiError(409, 'Game is not active');
      const firmIndex = game.firms.findIndex(firm => firm.firmId === kickMatch[2]);
      if (firmIndex < 0) throw new ApiError(404, 'Firm not found');
      game.firms.splice(firmIndex, 1);
      const league = game.snapshot?.league;
      if (league) {
        league.firms = league.firms.filter(firm => firm.id !== kickMatch[2]);
        for (const decisions of league.decisionsByPeriod) delete decisions[kickMatch[2]];
        for (const confirmed of league.confirmedByPeriod) delete confirmed[kickMatch[2]];
      }
    });
    return sendJson(res, 200, { ok: true });
  }
  const inviteRotateMatch = path.match(/^\/api\/admin\/games\/([^/]+)\/invite-token$/);
  if (req.method === 'POST' && inviteRotateMatch) { requireAdmin(req, admin); const token = secret(); await repo.update(s => { const g = s.games[inviteRotateMatch[1]]; if (!g) throw new ApiError(404, 'Game not found'); if (g.phase !== 'lobby' || !g.open) throw new ApiError(409, 'Game lobby is closed'); g.inviteTokenHash = hash(token); }); return sendJson(res, 200, { inviteToken: token }); }
  const startMatch = path.match(/^\/api\/games\/([^/]+)\/start$/);
  if (req.method === 'POST' && startMatch) { requireAdmin(req, admin); const result = await repo.update(s => { const g=s.games[startMatch[1]]; if(!g) throw new ApiError(404,'Game not found'); if(g.phase !== 'lobby' || !g.open) throw new ApiError(409,'Game already started or closed'); if(g.firms.length<2) throw new ApiError(409,'At least two firms are required'); initializeGame(g); return adminDto(g); }); return sendJson(res,200,result); }
  const macroMatch = path.match(/^\/api\/admin\/games\/([^/]+)\/macro$/);
  if (req.method === 'PUT' && macroMatch) { requireAdmin(req,admin); const patch=await jsonBody(req); await repo.update(s=>{const g=s.games[macroMatch[1]]; if(!g?.snapshot) throw new ApiError(404,'Game not found'); if(g.phase==='closed') throw new ApiError(409,'Game is closed'); if(g.phase==='complete') throw new ApiError(409,'Game is complete'); const i=g.snapshot.league.results.length; const old=g.snapshot.league.macroByPeriod[i] ?? makeMacroParams(i); g.snapshot.league.macroByPeriod[i]=mergeMacro(old,patch);}); return sendJson(res,200,{ok:true}); }
  const calculateMatch = path.match(/^\/api\/admin\/games\/([^/]+)\/calculate$/);
  if(req.method==='POST' && calculateMatch){requireAdmin(req,admin); const result=await repo.update(s=>{const g=s.games[calculateMatch[1]];if(!g?.snapshot)throw new ApiError(404,'Game not found');if(g.phase!=='collecting')throw new ApiError(409,'Game is not collecting decisions');if(g.firms.some(f=>!f.submitted||!f.decision))throw new ApiError(409,'Every firm must submit');const league=g.snapshot.league, i=league.results.length, decisions=Object.fromEntries(g.firms.map(f=>[f.firmId,{...f.decision!,firmId:f.firmId}]));const period=computePeriod({periodIndex:i,config:league.config,macro:league.macroByPeriod[i],firms:league.firms.map(f=>({id:f.id,name:f.name})),opening:g.snapshot.opening,decisions,previousIndustry:league.results.at(-1)?.industry});league.results.push(period);g.snapshot.opening=nextOpeningState(g.snapshot.opening,period);if(i+1<8){league.macroByPeriod[i+1]={...(league.macroByPeriod[i+1] ?? makeMacroParams(i+1)),periodIndex:i+1};league.decisionsByPeriod[i+1]={...league.decisionsByPeriod[i]};for(const f of g.firms){const {price,production,marketing,capexGross,rnd}=decisions[f.firmId];f.decision={price,production,marketing,capexGross,rnd};f.submitted=false;league.decisionsByPeriod[i+1][f.firmId]=decisions[f.firmId];}}else g.phase='complete';return period;});return sendJson(res,200,result);}
  const closeMatch = path.match(/^\/api\/games\/([^/]+)\/close$/);
  if (req.method === 'POST' && closeMatch) { requireAdmin(req, admin); await repo.update(state => { const g = state.games[closeMatch[1]]; if (!g) throw new ApiError(404, 'Game not found'); g.open = false; g.phase = 'closed'; }); return sendJson(res, 200, { ok: true }); }
  sendJson(res, 404, { error: 'Not found' });
}

function validSnapshot(value: unknown): value is LeagueSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const s=value as Record<string, unknown>, l=s.league as Record<string, unknown> | undefined;
  if (!l || typeof l !== 'object' || !l.config || typeof l.config !== 'object' || !Array.isArray(l.firms) || !Array.isArray(l.macroByPeriod) || !Array.isArray(l.results) || !Array.isArray(l.decisionsByPeriod) || !Array.isArray(l.confirmedByPeriod) || !s.opening || typeof s.opening !== 'object') return false;
  const m=l.macroByPeriod[0] as Record<string, unknown> | undefined;
  return !!m && typeof m==='object' && ['taxRate','bankRateBase','bankRateExtra','loanLimitBase','loanLimitAbs','rifWeightRetainedProfit','rifWeightDemandPotential','rifWeightSupplyPotential','rifWeightEfficiency','rifWeightMarketShare','rifWeightGrowth'].every(k=>typeof m[k]==='number'&&Number.isFinite(m[k])) && typeof m.scenarioNewsText==='string';
}
function defaultSnapshot(gameId: string, name: string): LeagueSnapshot {
  const league: League = { id: gameId, name, createdAt: new Date().toISOString(), config: structuredClone(DEFAULT_LEAGUE_CONFIG), firms: [], macroByPeriod: [makeMacroParams(0)], decisionsByPeriod: [{}], confirmedByPeriod: [{}], results: [] };
  return { league, opening: {} };
}
function freshSnapshot(source: LeagueSnapshot, gameId: string, name: string): LeagueSnapshot {
  const macroByPeriod = source.league.macroByPeriod.map((macro, periodIndex) => ({ ...macro, periodIndex }));
  const league: League={...source.league,id:gameId,name,firms:[],results:[],macroByPeriod,decisionsByPeriod:[{}],confirmedByPeriod:[{}]};
  return {league,opening:{}};
}
function initializeGame(g: Game): void {
  if(!g.snapshot) throw new ApiError(409,'Game snapshot missing');
  const l=g.snapshot.league;
  l.firms=g.firms.map(f=>({id:f.firmId,name:f.firmName,...makeFirmStart(g.firms.length,l.config.machineCost)}));
  const periodZeroDecisions=Object.fromEntries(g.firms.map(f=>[f.firmId,makeFirmDecision(f.firmId,g.firms.length)]));
  l.decisionsByPeriod=[periodZeroDecisions];
  l.confirmedByPeriod=[{}];
  g.snapshot.opening=initialOpeningState(l);
  const periodZero=computePeriod({
    periodIndex:0,
    config:l.config,
    macro:l.macroByPeriod[0],
    firms:l.firms.map(f=>({id:f.id,name:f.name})),
    opening:g.snapshot.opening,
    decisions:periodZeroDecisions,
  });
  l.results=[periodZero];
  g.snapshot.opening=nextOpeningState(g.snapshot.opening,periodZero);
  l.macroByPeriod[1]={...(l.macroByPeriod[1] ?? makeMacroParams(1)),periodIndex:1};
  l.decisionsByPeriod[1]={...periodZeroDecisions};
  l.confirmedByPeriod[1]={};
  for(const f of g.firms){const {price,production,marketing,capexGross,rnd}=periodZeroDecisions[f.firmId];f.decision={price,production,marketing,capexGross,rnd};f.submitted=false;}
  g.open=false;
  g.phase='collecting';
}
function adminDto(g: Game): unknown { const {inviteTokenHash:_,...safe}=g; return {...safe,firms:g.firms.map(({rejoinTokenHash:__,...f})=>f)}; }
function playerDto(g: Game,f: Firm): unknown {
  const league=g.snapshot?.league, index=league?.results.length ?? 0, history: {periodIndex:number;report:string}[]=[];
  if(league) for(const period of league.results){const own=period.firms.find(x=>x.firmId===f.firmId);if(own)history.push({periodIndex:period.periodIndex,report:renderFirmExport(own,period,league.config,league.name)});}
  const current=history.at(-1)?.report ?? null;
  const openingState = g.phase === 'lobby' ? null : g.snapshot?.opening[f.firmId] ?? null;
  const periodMacro = league?.macroByPeriod[index] ?? null;
  return {gameId:g.gameId,firmId:f.firmId,firmName:f.firmName,decision:g.phase==='lobby'?null:f.decision,submitted:f.submitted,phase:g.phase??(g.open?'lobby':'collecting'),currentPeriodIndex:index,report:current,reports:history,openingState,periodMacro};
}
const MACRO_KEYS=['demandOS','demandVM','demandVN','taxRate','bankRateBase','bankRateExtra','loanLimitBase','loanLimitAbs','rifWeightRetainedProfit','rifWeightDemandPotential','rifWeightSupplyPotential','rifWeightEfficiency','rifWeightMarketShare','rifWeightGrowth'] as const;
function mergeMacro(current: PeriodMacroParams, patch: unknown): PeriodMacroParams {
  if(!patch||typeof patch!=='object'||Array.isArray(patch))throw new ApiError(400,'Invalid macro');const p=patch as Record<string,unknown>, out={...current};
  for(const key of Object.keys(p)){if(key==='periodIndex')continue;if(key==='scenarioNewsText'){if(typeof p[key]!=='string')throw new ApiError(400,'Invalid scenarioNewsText');out.scenarioNewsText=p[key];continue;}if(!(MACRO_KEYS as readonly string[]).includes(key)||typeof p[key]!=='number'||!Number.isFinite(p[key]))throw new ApiError(400,`Invalid macro field: ${key}`);(out as Record<string,unknown>)[key]=p[key];}
  return out;
}
function findPlayer(repo: JsonRepository, token: string) { return repo.read().then(s => findPlayerInState(s, token)); }
function findPlayerInState(state: Awaited<ReturnType<JsonRepository['read']>>, token: string) {
  for (const game of Object.values(state.games)) for (const firm of game.firms) if (secureMatch(token, firm.rejoinTokenHash)) return { game, firm };
  throw new ApiError(401, 'Invalid player token');
}
function requireAdmin(req: IncomingMessage, expected: string) { const auth = req.headers.authorization ?? ''; const m = /^Bearer (.+)$/.exec(auth); if (!m || !secureMatch(m[1], hash(expected))) throw new ApiError(401, 'Unauthorized'); }
function header(req: IncomingMessage, name: string): string { const value = req.headers[name]; if (typeof value !== 'string' || !value) throw new ApiError(401, 'Missing token'); return value; }
function readName(body: unknown, field: string): string { if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'Invalid request'); const name = (body as Record<string, unknown>)[field]; if (typeof name !== 'string' || !name.trim() || name.trim().length > MAX_NAME) throw new ApiError(400, `Invalid ${field}`); return name.trim(); }
async function jsonBody(req: IncomingMessage): Promise<unknown> { if (req.headers['content-type']?.split(';',1)[0]?.trim().toLowerCase() !== 'application/json') throw new ApiError(415, 'Content-Type must be application/json'); const text = await readBody(req); try { return JSON.parse(text); } catch { throw new ApiError(400, 'Invalid JSON'); } }
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        settled = true;
        reject(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', error => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}
function sendJson(res: ServerResponse, status: number, value: unknown): void { if (res.headersSent || res.destroyed) return; res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); }

async function serveStatic(req: IncomingMessage, res: ServerResponse, urlPath: string, webRoot: string): Promise<boolean> {
  let requestedPath: string;
  try { requestedPath = decodeURIComponent(urlPath); } catch { return false; }
  const root = resolve(webRoot);
  const candidate = resolve(root, `.${requestedPath}`);
  const rel = relative(root, candidate);
  if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || resolve(root, rel) !== candidate) return false;
  let filePath = candidate === root || requestedPath.endsWith('/') ? resolve(root, 'index.html') : candidate;
  try {
    const content = await readFile(filePath);
    res.writeHead(200, { 'content-type': contentType(extname(filePath)), 'cache-control': extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable' });
    res.end(content);
    return true;
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  if (extname(requestedPath) || !req.headers.accept?.includes('text/html')) return false;
  filePath = resolve(root, 'index.html');
  try {
    const content = await readFile(filePath);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
    res.end(content);
    return true;
  } catch (error) {
    if (!isNotFound(error)) throw error;
    return false;
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function contentType(extension: string): string {
  switch (extension.toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'text/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg': case '.jpeg': return 'image/jpeg';
    case '.woff2': return 'font/woff2';
    default: return 'application/octet-stream';
  }
}

