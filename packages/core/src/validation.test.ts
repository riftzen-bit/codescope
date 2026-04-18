import { describe, it, expect } from 'vitest';
import { assertLocalUrl } from './validation.js';

describe('assertLocalUrl', () => {
  describe('loopback (always allowed)', () => {
    it('accepts localhost http', () => {
      expect(assertLocalUrl('http://localhost:11434')).toBe('http://localhost:11434');
    });

    it('accepts 127.0.0.1', () => {
      expect(assertLocalUrl('http://127.0.0.1:11434')).toBe('http://127.0.0.1:11434');
    });

    it('accepts ::1', () => {
      expect(assertLocalUrl('http://[::1]:11434')).toBe('http://[::1]:11434');
    });

    it('strips trailing slash', () => {
      expect(assertLocalUrl('http://localhost:11434/')).toBe('http://localhost:11434');
    });
  });

  describe('protocol', () => {
    it('rejects non-http(s)', () => {
      expect(() => assertLocalUrl('ftp://localhost')).toThrow();
      expect(() => assertLocalUrl('javascript:alert(1)')).toThrow();
      expect(() => assertLocalUrl('file:///etc/passwd')).toThrow();
    });

    it('rejects malformed', () => {
      expect(() => assertLocalUrl('not a url')).toThrow();
      expect(() => assertLocalUrl('')).toThrow();
    });

    it('rejects non-string input', () => {
      expect(() => assertLocalUrl(null as unknown as string)).toThrow();
      expect(() => assertLocalUrl(42 as unknown as string)).toThrow();
    });
  });

  describe('LAN (disabled)', () => {
    it('rejects RFC1918 when LAN off', () => {
      expect(() => assertLocalUrl('http://192.168.1.1', false)).toThrow();
      expect(() => assertLocalUrl('http://10.0.0.1', false)).toThrow();
      expect(() => assertLocalUrl('http://172.16.0.1', false)).toThrow();
    });

    it('rejects arbitrary hosts when LAN off', () => {
      expect(() => assertLocalUrl('http://evil.example.com', false)).toThrow();
    });
  });

  describe('LAN (enabled)', () => {
    it('accepts RFC1918 when LAN on', () => {
      expect(assertLocalUrl('http://192.168.1.1', true)).toBe('http://192.168.1.1');
      expect(assertLocalUrl('http://10.0.0.1', true)).toBe('http://10.0.0.1');
      expect(assertLocalUrl('http://172.16.0.1', true)).toBe('http://172.16.0.1');
      expect(assertLocalUrl('http://172.31.255.255', true)).toBe('http://172.31.255.255');
    });

    it('rejects public IPv4 even when LAN on', () => {
      expect(() => assertLocalUrl('http://8.8.8.8', true)).toThrow();
      expect(() => assertLocalUrl('http://172.15.0.1', true)).toThrow(); // just outside RFC1918
      expect(() => assertLocalUrl('http://172.32.0.1', true)).toThrow();
    });

    it('accepts IPv6 ULA (fc00::/7) and link-local', () => {
      expect(assertLocalUrl('http://[fc00::1]', true)).toBe('http://[fc00::1]');
      expect(assertLocalUrl('http://[fd12:3456:789a::1]', true)).toBe('http://[fd12:3456:789a::1]');
      expect(assertLocalUrl('http://[fe80::1]', true)).toBe('http://[fe80::1]');
    });

    it('rejects DNS names that happen to start with "fc"/"fd"/"fe"', () => {
      expect(() => assertLocalUrl('http://fcauseit.com', true)).toThrow();
      expect(() => assertLocalUrl('http://fd-spoof.example', true)).toThrow();
      expect(() => assertLocalUrl('http://fe80-looking-host.test', true)).toThrow();
    });

    it('rejects IPv4-shaped hostnames that look private but are not literals', () => {
      // DNS labels can't look exactly like IPv4, but a hostname like
      // "10.x.com" must not slip through the private-prefix check.
      expect(() => assertLocalUrl('http://10.foo.com', true)).toThrow();
    });

    it('accepts IPv4-mapped IPv6 for loopback', () => {
      // WHATWG URL normalizes ::ffff:127.0.0.1 → hex form on some runtimes.
      // Test both forms end up treated as loopback.
      expect(() => assertLocalUrl('http://[::ffff:127.0.0.1]', false)).not.toThrow();
      expect(() => assertLocalUrl('http://[::ffff:7f00:1]', false)).not.toThrow();
    });

    it('accepts IPv4-mapped IPv6 for RFC1918 when LAN on', () => {
      expect(() => assertLocalUrl('http://[::ffff:10.0.0.1]', true)).not.toThrow();
      expect(() => assertLocalUrl('http://[::ffff:192.168.1.1]', true)).not.toThrow();
      // Hex form: 0a00:0001 = 10.0.0.1
      expect(() => assertLocalUrl('http://[::ffff:a00:1]', true)).not.toThrow();
      // Hex form: c0a8:0101 = 192.168.1.1
      expect(() => assertLocalUrl('http://[::ffff:c0a8:101]', true)).not.toThrow();
    });

    it('rejects IPv4-mapped IPv6 for public v4 even when LAN on', () => {
      expect(() => assertLocalUrl('http://[::ffff:8.8.8.8]', true)).toThrow();
      // Hex form: 0808:0808 = 8.8.8.8
      expect(() => assertLocalUrl('http://[::ffff:808:808]', true)).toThrow();
    });

    it('rejects IPv4-mapped IPv6 for public v4 when LAN off', () => {
      expect(() => assertLocalUrl('http://[::ffff:8.8.8.8]', false)).toThrow();
    });
  });
});
