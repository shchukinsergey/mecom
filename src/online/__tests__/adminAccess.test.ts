import { describe, expect, it } from 'vitest';
import { buildAdminBootstrapLink, parseAdminBootstrap } from '../adminAccess';

const token = 'a'.repeat(43);

describe('admin bootstrap links', () => {
  it('keeps the access key in the fragment and restores the HTTPS player origin', () => {
    const link = buildAdminBootstrapLink(
      'http://127.0.0.1:8787/',
      'https://market.trycloudflare.com',
      token,
    );
    const url = new URL(link);

    expect(url.origin).toBe('http://127.0.0.1:8787');
    expect(url.searchParams.get('publicOrigin')).toBe('https://market.trycloudflare.com');
    expect(url.hash).toBe(`#manage/${token}`);
    expect(url.search).not.toContain(token);
    expect(parseAdminBootstrap(url.hash, url.search)).toEqual({
      token,
      publicOrigin: 'https://market.trycloudflare.com',
    });
  });

  it('rejects ordinary admin routes and malformed access keys', () => {
    expect(parseAdminBootstrap('#admin', '')).toBeNull();
    expect(parseAdminBootstrap('#manage/short', '')).toBeNull();
    expect(parseAdminBootstrap(`#manage/${token}`, '?publicOrigin=http%3A%2F%2Fplayers.example.test')).toBeNull();
  });

  it('allows local HTTP only for a local development player origin', () => {
    expect(buildAdminBootstrapLink('http://localhost:8787/', 'http://127.0.0.1:8787', token))
      .toContain('publicOrigin=http%3A%2F%2F127.0.0.1%3A8787');
    expect(() => buildAdminBootstrapLink('https://admin.example.test/', 'https://players.example.test', token))
      .toThrow(/local/i);
  });
});
