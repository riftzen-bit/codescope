import { describe, it, expect } from 'vitest';
import { redactSecrets, summarizeRedactions } from './redact.js';

describe('redactSecrets', () => {
  it('returns the input unchanged when nothing matches', () => {
    const src = 'function add(a, b) { return a + b; }';
    const { code, hits } = redactSecrets(src);
    expect(code).toBe(src);
    expect(hits).toEqual([]);
  });

  it('redacts AWS access keys', () => {
    const src = 'const key = "AKIAIOSFODNN7EXAMPLE";';
    const { code, hits } = redactSecrets(src);
    expect(code).toContain('[REDACTED:aws-access-key]');
    expect(code).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.kind).toBe('aws-access-key');
  });

  it('redacts GitHub tokens', () => {
    const src = 'token: ghp_1234567890abcdefghijklmnopqrstuvwxyz12';
    const { code, hits } = redactSecrets(src);
    expect(code).toContain('[REDACTED:github-token]');
    expect(hits[0]?.kind).toBe('github-token');
  });

  it('redacts Anthropic keys', () => {
    const src = 'ANTHROPIC=sk-ant-api03-abcdefghijABCDEFGHIJ1234567890-abc';
    const { code, hits } = redactSecrets(src);
    expect(code).toContain('[REDACTED:anthropic-key]');
    expect(hits[0]?.kind).toBe('anthropic-key');
  });

  it('redacts OpenAI keys including proj variant', () => {
    const src = 'KEY=sk-proj-ABCDEFghijklmnopqrstuvwx1234';
    const { code, hits } = redactSecrets(src);
    expect(code).toContain('[REDACTED:openai-api-key]');
    expect(hits[0]?.kind).toBe('openai-api-key');
  });

  it('redacts JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTYifQ.abcdefghijklmnopqrstuvw';
    const { code, hits } = redactSecrets(`const t = "${jwt}";`);
    expect(code).toContain('[REDACTED:jwt]');
    expect(hits[0]?.kind).toBe('jwt');
  });

  it('redacts PEM private key blocks', () => {
    const src = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA...junk...
-----END RSA PRIVATE KEY-----`;
    const { code, hits } = redactSecrets(src);
    expect(code).toContain('[REDACTED:private-key-block]');
    expect(hits[0]?.kind).toBe('private-key-block');
    expect(code).not.toContain('BEGIN RSA PRIVATE KEY');
  });

  it('records line numbers', () => {
    const src = '// first\n// second\nconst k = "AKIAIOSFODNN7EXAMPLE";';
    const { hits } = redactSecrets(src);
    expect(hits[0]?.line).toBe(3);
  });

  it('handles multiple hits across multiple rules', () => {
    const src = `token=ghp_1234567890abcdefghijklmnopqrstuvwxyz12
aws=AKIAIOSFODNN7EXAMPLE`;
    const { hits } = redactSecrets(src);
    expect(hits).toHaveLength(2);
    const kinds = hits.map((h) => h.kind).sort();
    expect(kinds).toEqual(['aws-access-key', 'github-token']);
  });

  it('redacts NPM tokens', () => {
    const src = 'NPM=npm_abcdef0123456789abcdef0123456789abcd';
    const { code, hits } = redactSecrets(src);
    expect(code).toContain('[REDACTED:npm-token]');
    expect(hits[0]?.kind).toBe('npm-token');
  });

  it('redacts Azure storage connection strings', () => {
    const src = 'CONN="DefaultEndpointsProtocol=https;AccountName=myacct;AccountKey=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/abcdefgh==;EndpointSuffix=core.windows.net"';
    const { code, hits } = redactSecrets(src);
    expect(code).toContain('[REDACTED:azure-storage-connstr]');
    expect(code).not.toContain('AccountKey=abcdef');
    expect(hits[0]?.kind).toBe('azure-storage-connstr');
  });

  it('redacts bare AccountKey= assignments', () => {
    const src = 'key=AccountKey=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/abcdefgh==';
    const { code, hits } = redactSecrets(src);
    expect(code).toContain('[REDACTED:azure-storage-key]');
    expect(hits[0]?.kind).toBe('azure-storage-key');
  });

  it('redacts GCP service-account JSON blobs', () => {
    const src = `{
  "type": "service_account",
  "project_id": "demo",
  "private_key_id": "abcdef0123456789abcdef0123456789abcdef01"
}`;
    const { code, hits } = redactSecrets(src);
    expect(code).toContain('[REDACTED:gcp-service-account]');
    expect(hits[0]?.kind).toBe('gcp-service-account');
  });

  it('redacts database connection URIs with embedded password', () => {
    const src = 'const DB = "postgresql://appuser:hunter2@db.example.com:5432/prod";';
    const { code, hits } = redactSecrets(src);
    expect(code).toContain('[REDACTED:db-connection-uri]');
    expect(code).not.toContain('hunter2');
    expect(hits[0]?.kind).toBe('db-connection-uri');
  });

  it('redacts MongoDB SRV URIs', () => {
    const src = 'mongodb+srv://user:p%40ss@cluster.example.net/app';
    const { code, hits } = redactSecrets(src);
    expect(code).toContain('[REDACTED:db-connection-uri]');
    expect(hits[0]?.kind).toBe('db-connection-uri');
  });

  it('redacts bearer tokens in authorization headers', () => {
    const src = 'headers: { Authorization: "Bearer abc123DEFGHIJklmnopQRSTuvwxyz-_=+/012345678" }';
    const { code, hits } = redactSecrets(src);
    expect(code).toContain('[REDACTED:bearer-token]');
    expect(hits[0]?.kind).toBe('bearer-token');
  });

  it('does not over-match short Bearer-looking strings', () => {
    const src = 'Bearer short';
    const { code } = redactSecrets(src);
    expect(code).toBe(src);
  });
});

describe('summarizeRedactions', () => {
  it('says no secrets when empty', () => {
    expect(summarizeRedactions([])).toBe('No secrets detected');
  });

  it('counts by kind', () => {
    const s = summarizeRedactions([
      { kind: 'aws-access-key', line: 1, start: 0, length: 20 },
      { kind: 'aws-access-key', line: 2, start: 10, length: 20 },
      { kind: 'jwt', line: 3, start: 40, length: 60 },
    ]);
    expect(s).toContain('aws-access-key: 2');
    expect(s).toContain('jwt: 1');
  });
});
