import { describe, it, expect } from 'vitest';
import { ReviewEngine } from './engine.js';
import type { AIProvider, ChatMessage, ChatResponse } from '../providers/types.js';

type MockProvider = AIProvider & { lastMessages: ChatMessage[] | null };

function mockProvider(response: string, name = 'mock', model = 'test'): MockProvider {
  const provider: MockProvider = {
    name,
    model,
    lastMessages: null,
    async chat(messages: ChatMessage[]): Promise<ChatResponse> {
      provider.lastMessages = messages;
      return { text: response, model, tokensUsed: { input: 10, output: 20 } };
    },
    async stream(messages: ChatMessage[], onChunk: (t: string) => void): Promise<ChatResponse> {
      provider.lastMessages = messages;
      onChunk(response);
      return { text: response, model, tokensUsed: { input: 10, output: 20 } };
    },
  };
  return provider;
}

describe('ReviewEngine.review', () => {
  it('sends system + user messages and returns parsed result', async () => {
    const json = JSON.stringify({ summary: 'ok', score: 88, findings: [] });
    const provider = mockProvider(json);
    const engine = new ReviewEngine(provider);

    const result = await engine.review({ code: 'const x = 1;', filename: 'x.ts' });

    expect(provider.lastMessages).not.toBeNull();
    expect(provider.lastMessages![0]?.role).toBe('system');
    expect(provider.lastMessages![1]?.role).toBe('user');
    expect(provider.lastMessages![1]?.content).toContain('x.ts');

    expect(result.summary).toBe('ok');
    expect(result.score).toBe(88);
    expect(result.provider).toBe('mock');
    expect(result.model).toBe('test');
    expect(result.language).toBe('typescript');
    expect(result.tokensUsed).toEqual({ input: 10, output: 20 });
  });

  it('honours explicit language over detection', async () => {
    const json = JSON.stringify({ summary: 'x', score: 50, findings: [] });
    const engine = new ReviewEngine(mockProvider(json));
    const result = await engine.review({ code: 'x', filename: 'foo.ts', language: 'ruby' });
    expect(result.language).toBe('ruby');
  });

  it('forwards rules into the prompt', async () => {
    const json = JSON.stringify({ summary: 'x', score: 50, findings: [] });
    const provider = mockProvider(json);
    const engine = new ReviewEngine(provider);
    await engine.review({ code: 'x', rules: ['no eval', 'prefer const'] });
    expect(provider.lastMessages![1]?.content).toContain('no eval');
    expect(provider.lastMessages![1]?.content).toContain('prefer const');
  });
});

describe('ReviewEngine.reviewStream', () => {
  it('invokes onChunk and returns parsed result', async () => {
    const json = JSON.stringify({ summary: 'streamed', score: 77, findings: [] });
    const provider = mockProvider(json);
    const engine = new ReviewEngine(provider);

    const chunks: string[] = [];
    const result = await engine.reviewStream(
      { code: 'x' },
      (c) => chunks.push(c),
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(json);
    expect(result.summary).toBe('streamed');
    expect(result.score).toBe(77);
  });
});
