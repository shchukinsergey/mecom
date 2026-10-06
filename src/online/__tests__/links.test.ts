import { describe, expect, it } from 'vitest';
import { buildPlayerLink } from '../links';

describe('buildPlayerLink', () => {
  it('uses the public origin and keeps the credential in the client-side fragment', () => {
    expect(buildPlayerLink('https://play.example.test/', '/app/', 'join', 'invite-secret'))
      .toBe('https://play.example.test/app/#join/invite-secret');
  });

  it('rejects non-web origins and malformed addresses', () => {
    expect(buildPlayerLink('javascript:alert(1)', '/', 'join', 'secret')).toBe('');
    expect(buildPlayerLink('not a url', '/', 'firm', 'secret')).toBe('');
    expect(buildPlayerLink('http://players.example.test', '/', 'join', 'secret')).toBe('');
  });
});
