export interface AdminBootstrap {
  token: string;
  publicOrigin: string;
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function parseOrigin(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    if (url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback(url.hostname))) return url;
  } catch {
    return null;
  }
  return null;
}

/** Build a host-only admin URL. The credential is confined to the URL fragment. */
export function buildAdminBootstrapLink(localOrigin: string, publicOrigin: string, token: string): string {
  if (!TOKEN_PATTERN.test(token)) throw new Error('Invalid admin access key');
  const local = parseOrigin(localOrigin);
  if (!local || local.protocol !== 'http:' || !isLoopback(local.hostname)) {
    throw new Error('Admin bootstrap links must use a local HTTP origin');
  }
  const share = parseOrigin(publicOrigin);
  if (!share) throw new Error('Public origin must be HTTPS (or local HTTP for development)');

  const url = new URL(local.origin);
  url.searchParams.set('publicOrigin', share.origin);
  url.hash = `manage/${token}`;
  return url.toString();
}

/** Read a one-time launcher URL before the app removes its credential from browser history. */
export function parseAdminBootstrap(hash: string, search: string): AdminBootstrap | null {
  const match = /^#manage\/([A-Za-z0-9_-]{43})$/.exec(hash);
  if (!match) return null;

  const rawOrigin = new URLSearchParams(search).get('publicOrigin') ?? '';
  if (!rawOrigin) return { token: match[1], publicOrigin: '' };
  const origin = parseOrigin(rawOrigin);
  if (!origin) return null;
  return { token: match[1], publicOrigin: origin.origin };
}
