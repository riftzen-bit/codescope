import { describe, it, expect } from 'vitest';
import { runCli, type CliIO } from './index.js';

function makeIO(files: Record<string, string> = {}): CliIO & { out: string; err: string } {
  const buf = { out: '', err: '' };
  const io: CliIO & { out: string; err: string } = {
    readFile: async (p: string) => {
      if (!(p in files)) throw new Error(`ENOENT: ${p}`);
      return files[p] as string;
    },
    stdout: (t: string) => { buf.out += t; },
    stderr: (t: string) => { buf.err += t; },
    get out() { return buf.out; },
    get err() { return buf.err; },
  } as CliIO & { out: string; err: string };
  return io;
}

describe('runCli', () => {
  it('prints help and exits 1 with no args', async () => {
    const io = makeIO();
    const code = await runCli([], io);
    expect(code).toBe(1);
    expect(io.out).toContain('Usage');
  });

  it('help command exits 0', async () => {
    const io = makeIO();
    const code = await runCli(['help'], io);
    expect(code).toBe(0);
    expect(io.out).toContain('codescope');
  });

  it('--version prints a semver-like string', async () => {
    const io = makeIO();
    const code = await runCli(['--version'], io);
    expect(code).toBe(0);
    expect(io.out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('metrics produces JSON with expected keys', async () => {
    const io = makeIO({ 'a.ts': 'function a() {\n  if (x) { return 1; }\n}\n' });
    const code = await runCli(['metrics', 'a.ts'], io);
    expect(code).toBe(0);
    const parsed = JSON.parse(io.out);
    expect(parsed).toHaveProperty('branches');
    expect(parsed).toHaveProperty('commentRatio');
    expect(parsed).toHaveProperty('maxNesting');
  });

  it('metrics errors without file arg', async () => {
    const io = makeIO();
    const code = await runCli(['metrics'], io);
    expect(code).toBe(2);
    expect(io.err).toContain('missing');
  });

  it('redact removes obvious secrets and reports count on stderr', async () => {
    const io = makeIO({ 'secrets.js': 'const k = "sk-ant-abcdefghij1234567890xyz";\n' });
    const code = await runCli(['redact', 'secrets.js'], io);
    expect(code).toBe(0);
    expect(io.out).toContain('[REDACTED:anthropic-key]');
    expect(io.err).toMatch(/1 secret redacted/);
  });

  it('redact --stats outputs JSON and no code', async () => {
    const io = makeIO({ 's.js': 'const k = "sk-ant-abcdefghij1234567890xyz";\n' });
    const code = await runCli(['redact', 's.js', '--stats'], io);
    expect(code).toBe(0);
    const parsed = JSON.parse(io.out);
    expect(parsed.hitCount).toBe(1);
    expect(parsed.summary).toContain('anthropic-key');
  });

  it('pie outputs an svg element', async () => {
    const findings = [{ id: '1', severity: 'error', category: 'security', title: 't', description: '', suggestion: '' }];
    const io = makeIO({ 'f.json': JSON.stringify(findings) });
    const code = await runCli(['pie', 'f.json'], io);
    expect(code).toBe(0);
    expect(io.out).toMatch(/^<svg/);
    expect(io.out).toContain('</svg>');
  });

  it('summary accepts a ReviewResult-shaped object', async () => {
    const result = {
      findings: [
        { id: '1', severity: 'critical', category: 'security', title: 'SQLi', description: '', suggestion: '' },
        { id: '2', severity: 'warning', category: 'style', title: 'nit', description: '', suggestion: '' },
      ],
    };
    const io = makeIO({ 'r.json': JSON.stringify(result) });
    const code = await runCli(['summary', 'r.json'], io);
    expect(code).toBe(0);
    const parsed = JSON.parse(io.out);
    expect(parsed.total).toBe(2);
    expect(parsed.bySeverity.critical).toBe(1);
    expect(parsed.top[0].severity).toBe('critical');
  });

  it('rejects non-array / non-findings-object input', async () => {
    const io = makeIO({ 'bad.json': '{"foo": 1}' });
    const code = await runCli(['summary', 'bad.json'], io);
    expect(code).toBe(1);
    expect(io.err).toContain('summary');
  });

  it('unknown command returns 2 and shows help', async () => {
    const io = makeIO();
    const code = await runCli(['nope'], io);
    expect(code).toBe(2);
    expect(io.err).toContain('Unknown command');
    expect(io.err).toContain('Usage');
  });
});
