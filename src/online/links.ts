export type PlayerLinkKind = 'join' | 'firm';

export function buildPlayerLink(origin: string, pathname: string, kind: PlayerLinkKind, token: string): string {
  try {
    const url = new URL(origin);
    const isLocalHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !isLocalHttp) return '';
    if (!token) return '';
    const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
    return `${url.origin}${path}#${kind}/${encodeURIComponent(token)}`;
  } catch {
    return '';
  }
}
