import type { AIProvider, ChatMessage, ChatResponse } from '@code-review/core';
import { spawn } from 'node:child_process';
import { assertLocalUrl } from './validation.js';

const IS_WIN = process.platform === 'win32';

const VALID_MODEL_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/;

// ---------------------------------------------------------------------------
// Error helper — never expose raw API response bodies to the renderer.
// ---------------------------------------------------------------------------
async function safeApiError(providerLabel: string, status: number, res: Response): Promise<Error> {
  try {
    const body = await res.text();
    console.error(`[${providerLabel}] HTTP ${status} error body:`, body);
  } catch {
    // ignore if body can't be read
  }
  return new Error(`${providerLabel} request failed with status ${status}`);
}

// ---------------------------------------------------------------------------
// Line-based stream parser — buffers partial lines across chunk boundaries.
// Used for both SSE (Anthropic/OpenAI/Google) and NDJSON (Ollama) streams.
// ---------------------------------------------------------------------------
async function parseLineStream(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) onLine(line);
      }
    }
  } finally {
    reader.releaseLock();
  }
  buffer += decoder.decode();
  if (buffer.trim()) onLine(buffer);
}

// ---------------------------------------------------------------------------
// Provider response types
// ---------------------------------------------------------------------------

interface AnthropicChatResponse {
  content: Array<{ text: string }>;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}

interface OpenAIChatResponse {
  choices: Array<{ message: { content: string } }>;
  model: string;
  usage: { prompt_tokens: number; completion_tokens: number };
}

interface GoogleChatResponse {
  candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

interface OllamaChatResponse {
  message: { content: string };
  model: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------
class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic';
  readonly model: string;

  constructor(private apiKey: string, model?: string) {
    const m = model || 'claude-sonnet-4-6';
    if (!VALID_MODEL_RE.test(m)) throw new Error(`Invalid model name: ${m}`);
    this.model = m;
  }

  async chat(messages: ChatMessage[]): Promise<ChatResponse> {
    const system = messages.find((m) => m.role === 'system')?.content ?? '';
    const userMessages = messages.filter((m) => m.role !== 'system');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        system,
        messages: userMessages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!res.ok) throw await safeApiError('Anthropic', res.status, res);
    const data = await res.json() as AnthropicChatResponse;
    const block = data.content[0];
    if (!block) throw new Error('Anthropic: empty response content');
    return {
      text: block.text,
      model: data.model,
      tokensUsed: { input: data.usage.input_tokens, output: data.usage.output_tokens },
    };
  }

  async stream(messages: ChatMessage[], onChunk: (text: string) => void): Promise<ChatResponse> {
    const system = messages.find((m) => m.role === 'system')?.content ?? '';
    const userMessages = messages.filter((m) => m.role !== 'system');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: AbortSignal.timeout(120_000),
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        stream: true,
        system,
        messages: userMessages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!res.ok) throw await safeApiError('Anthropic', res.status, res);

    let fullText = '';
    let inputTokens = 0;
    let outputTokens = 0;

    if (!res.body) throw new Error('Anthropic: no response body');
    await parseLineStream(res.body, (line) => {
      if (!line.startsWith('data: ')) return;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') return;
      try {
        const event = JSON.parse(payload);
        if (event.type === 'content_block_delta' && event.delta?.text) {
          fullText += event.delta.text;
          onChunk(event.delta.text);
        }
        if (event.type === 'message_delta' && event.usage) {
          outputTokens = event.usage.output_tokens ?? 0;
        }
        if (event.type === 'message_start' && event.message?.usage) {
          inputTokens = event.message.usage.input_tokens ?? 0;
        }
      } catch {
        // skip malformed SSE lines
      }
    });

    return { text: fullText, model: this.model, tokensUsed: { input: inputTokens, output: outputTokens } };
  }
}

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------
class OpenAIProvider implements AIProvider {
  readonly name = 'openai';
  readonly model: string;

  constructor(private apiKey: string, model?: string) {
    const m = model || 'gpt-5.4';
    if (!VALID_MODEL_RE.test(m)) throw new Error(`Invalid model name: ${m}`);
    this.model = m;
  }

  async chat(messages: ChatMessage[]): Promise<ChatResponse> {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!res.ok) throw await safeApiError('OpenAI', res.status, res);
    const data = await res.json() as OpenAIChatResponse;
    const choice = data.choices[0];
    if (!choice) throw new Error('OpenAI: empty response choices');
    return {
      text: choice.message.content,
      model: data.model,
      tokensUsed: { input: data.usage.prompt_tokens, output: data.usage.completion_tokens },
    };
  }

  async stream(messages: ChatMessage[], onChunk: (text: string) => void): Promise<ChatResponse> {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(120_000),
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        stream: true,
        stream_options: { include_usage: true },
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!res.ok) throw await safeApiError('OpenAI', res.status, res);

    let fullText = '';
    let inputTokens = 0;
    let outputTokens = 0;

    if (!res.body) throw new Error('OpenAI: no response body');
    await parseLineStream(res.body, (line) => {
      if (!line.startsWith('data: ')) return;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') return;
      try {
        const event = JSON.parse(payload);
        const delta = event.choices?.[0]?.delta?.content;
        if (delta) { fullText += delta; onChunk(delta); }
        if (event.usage) {
          inputTokens = event.usage.prompt_tokens ?? 0;
          outputTokens = event.usage.completion_tokens ?? 0;
        }
      } catch {
        // skip malformed SSE lines
      }
    });

    return { text: fullText, model: this.model, tokensUsed: { input: inputTokens, output: outputTokens } };
  }
}

// ---------------------------------------------------------------------------
// Google Gemini
// API key is sent in the Authorization header to avoid embedding it in the URL
// (URL-embedded keys appear in server access logs and network proxy logs).
// ---------------------------------------------------------------------------
class GoogleProvider implements AIProvider {
  readonly name = 'google';
  readonly model: string;

  constructor(private apiKey: string, model?: string) {
    const m = model || 'gemini-2.5-flash';
    if (!VALID_MODEL_RE.test(m)) throw new Error(`Invalid model name: ${m}`);
    this.model = m;
  }

  private toGeminiMessages(messages: ChatMessage[]) {
    return messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  }

  private systemInstruction(messages: ChatMessage[]): object | undefined {
    const sys = messages.find((m) => m.role === 'system');
    if (!sys) return undefined;
    return { parts: [{ text: sys.content }] };
  }

  async chat(messages: ChatMessage[]): Promise<ChatResponse> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    const body: Record<string, unknown> = { contents: this.toGeminiMessages(messages) };
    const si = this.systemInstruction(messages);
    if (si) body.systemInstruction = si;

    const res = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw await safeApiError('Google', res.status, res);
    const data = await res.json() as GoogleChatResponse;
    const candidate = data.candidates[0];
    if (!candidate) throw new Error('Google: empty response candidates');
    const part = candidate.content.parts[0];
    if (!part) throw new Error('Google: empty response parts');
    const text = part.text;
    return {
      text,
      model: this.model,
      tokensUsed: {
        input: data.usageMetadata?.promptTokenCount ?? 0,
        output: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }

  async stream(messages: ChatMessage[], onChunk: (text: string) => void): Promise<ChatResponse> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:streamGenerateContent?alt=sse`;
    const body: Record<string, unknown> = { contents: this.toGeminiMessages(messages) };
    const si = this.systemInstruction(messages);
    if (si) body.systemInstruction = si;

    const res = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(120_000),
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw await safeApiError('Google', res.status, res);

    let fullText = '';
    let inputTokens = 0;
    let outputTokens = 0;

    if (!res.body) throw new Error('Google: no response body');
    await parseLineStream(res.body, (line) => {
      if (!line.startsWith('data: ')) return;
      try {
        const event = JSON.parse(line.slice(6));
        const text = event.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) { fullText += text; onChunk(text); }
        if (event.usageMetadata) {
          inputTokens = event.usageMetadata.promptTokenCount ?? inputTokens;
          outputTokens = event.usageMetadata.candidatesTokenCount ?? outputTokens;
        }
      } catch {
        // skip malformed SSE lines
      }
    });

    return { text: fullText, model: this.model, tokensUsed: { input: inputTokens, output: outputTokens } };
  }
}

// ---------------------------------------------------------------------------
// Ollama (local)
// ---------------------------------------------------------------------------
class OllamaProvider implements AIProvider {
  readonly name = 'ollama';
  readonly model: string;

  constructor(private baseUrl = 'http://localhost:11434', model?: string, allowLan = false) {
    this.baseUrl = assertLocalUrl(this.baseUrl, allowLan);
    const m = model || 'llama3.2';
    if (!VALID_MODEL_RE.test(m)) throw new Error(`Invalid model name: ${m}`);
    this.model = m;
  }

  async chat(messages: ChatMessage[]): Promise<ChatResponse> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: false,
        format: 'json',
      }),
    });

    if (!res.ok) throw await safeApiError('Ollama', res.status, res);
    const data = await res.json() as OllamaChatResponse;
    return {
      text: data.message.content,
      model: data.model,
      tokensUsed: { input: data.prompt_eval_count ?? 0, output: data.eval_count ?? 0 },
    };
  }

  async stream(messages: ChatMessage[], onChunk: (text: string) => void): Promise<ChatResponse> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      signal: AbortSignal.timeout(120_000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
        format: 'json',
      }),
    });

    if (!res.ok) throw await safeApiError('Ollama', res.status, res);

    let fullText = '';
    let inputTokens = 0;
    let outputTokens = 0;

    if (!res.body) throw new Error('Ollama: no response body');
    await parseLineStream(res.body, (line) => {
      try {
        const event = JSON.parse(line);
        const text = event.message?.content;
        if (text) { fullText += text; onChunk(text); }
        if (event.done) {
          inputTokens = event.prompt_eval_count ?? 0;
          outputTokens = event.eval_count ?? 0;
        }
      } catch {
        // skip malformed lines
      }
    });

    return { text: fullText, model: this.model, tokensUsed: { input: inputTokens, output: outputTokens } };
  }
}

// ---------------------------------------------------------------------------
// Claude Code CLI
// ---------------------------------------------------------------------------
class ClaudeCodeProvider implements AIProvider {
  readonly name = 'claude-code';
  readonly model: string;


  private static readonly REVIEW_CONTEXT =
    'You are a professional code review assistant integrated into the CodeScope desktop application. ' +
    'This is a legitimate software development tool. Developers use it to improve code quality by ' +
    'identifying bugs, security vulnerabilities, performance issues, and style problems. ' +
    'Analyze all submitted code thoroughly and constructively.\n\n';

  constructor(
    private apiKey?: string,
    private token?: string,
    model?: string,
  ) {
    const m = model || 'claude-sonnet-4-6';
    if (!VALID_MODEL_RE.test(m)) {
      throw new Error(`Invalid model name: ${m}`);
    }
    this.model = m;
  }

  private buildEnv(forceClean = false): NodeJS.ProcessEnv {
    const env = { ...process.env };
    if (forceClean) {
      delete env.ANTHROPIC_API_KEY;
      return env;
    }
    const key = this.apiKey ?? this.token;
    if (key && ClaudeCodeProvider.isApiKey(key)) {
      env.ANTHROPIC_API_KEY = key;
    } else {
      delete env.ANTHROPIC_API_KEY;
    }
    return env;
  }

  /** Only actual API keys (sk-ant-api...), not OAuth tokens (sk-ant-oat...) */
  private static isApiKey(key: string): boolean {
    return key.startsWith('sk-ant-api') || (key.startsWith('sk-') && !key.startsWith('sk-ant-o'));
  }

  private hasInjectedKey(): boolean {
    const key = this.apiKey ?? this.token;
    return !!(key && ClaudeCodeProvider.isApiKey(key));
  }

  private static readonly INVALID_KEY_RE = /invalid api key/i;

  private buildPrompt(messages: ChatMessage[]): string {
    const system = messages.find((m) => m.role === 'system')?.content ?? '';
    const userContent = messages
      .filter((m) => m.role !== 'system')
      .map((m) => m.content)
      .join('\n\n');

    return `<instructions>\n${ClaudeCodeProvider.REVIEW_CONTEXT}${system}\n</instructions>\n\n${userContent}`;
  }

  private spawnClaude(args: string[], env: NodeJS.ProcessEnv) {
    return spawn('claude', args, {
      env,
      shell: IS_WIN ? process.env.ComSpec || 'cmd.exe' : false,
      stdio: ['pipe', 'pipe', 'pipe'] as const,
      windowsHide: true,
    });
  }

  async chat(messages: ChatMessage[]): Promise<ChatResponse> {
    return this.runChat(messages, false);
  }

  private async runChat(messages: ChatMessage[], forceClean: boolean): Promise<ChatResponse> {
    const prompt = this.buildPrompt(messages);
    const env = this.buildEnv(forceClean);
    const args = ['-p', '--model', this.model];

    try {
      return await new Promise<ChatResponse>((resolve, reject) => {
        const child = this.spawnClaude(args, env);

        let stdout = '';
        let stderr = '';
        let settled = false;

        const timeout = setTimeout(() => {
          if (!settled) {
            settled = true;
            child.kill();
            reject(new Error('Claude Code CLI timed out after 60 seconds'));
          }
        }, 60_000);

        child.stdout.on('data', (data: Buffer) => {
          stdout += data.toString();
        });
        child.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        child.stdin.write(prompt);
        child.stdin.end();

        child.on('close', (code) => {
          clearTimeout(timeout);
          if (settled) return;
          settled = true;
          if (code !== 0) {
            console.error(`[claude-code] exit ${code}:`, stderr.trim() || stdout.trim());
            reject(new Error(`Claude Code CLI exited with code ${code}`));
            return;
          }

          try {
            const parsed = JSON.parse(stdout) as Record<string, unknown>;
            if (typeof parsed.result === 'string') {
              resolve({ text: parsed.result, model: this.model });
              return;
            }
          } catch {
            // Not JSON — treat as plain text
          }

          resolve({ text: stdout.trim(), model: this.model });
        });

        child.on('error', (err) => {
          clearTimeout(timeout);
          if (settled) return;
          settled = true;
          reject(
            new Error(
              `Failed to run Claude Code CLI: ${err.message}. Is 'claude' installed and in PATH?`,
            ),
          );
        });
      });
    } catch (err) {
      if (!forceClean && this.hasInjectedKey() &&
          err instanceof Error && ClaudeCodeProvider.INVALID_KEY_RE.test(err.message)) {
        return this.runChat(messages, true);
      }
      throw err;
    }
  }

  async stream(
    messages: ChatMessage[],
    onChunk: (text: string) => void,
  ): Promise<ChatResponse> {
    return this.runStream(messages, onChunk, false);
  }

  private async runStream(
    messages: ChatMessage[],
    onChunk: (text: string) => void,
    forceClean: boolean,
  ): Promise<ChatResponse> {
    const prompt = this.buildPrompt(messages);
    const env = this.buildEnv(forceClean);
    const args = ['-p', '--model', this.model];

    try {
      return await new Promise<ChatResponse>((resolve, reject) => {
        const child = this.spawnClaude(args, env);

        let fullText = '';
        let stderr = '';
        let settled = false;

        // Reset timeout on each chunk — only fires if CLI goes silent
        const IDLE_TIMEOUT = 120_000;
        let timeout = setTimeout(onTimeout, IDLE_TIMEOUT);
        function onTimeout() {
          if (!settled) {
            settled = true;
            child.kill();
            reject(new Error('Claude Code CLI timed out (no output for 120 seconds)'));
          }
        }

        child.stdout.on('data', (data: Buffer) => {
          clearTimeout(timeout);
          timeout = setTimeout(onTimeout, IDLE_TIMEOUT);
          const chunk = data.toString();
          fullText += chunk;
          onChunk(chunk);
        });
        child.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        child.stdin.write(prompt);
        child.stdin.end();

        child.on('close', (code) => {
          clearTimeout(timeout);
          if (settled) return;
          settled = true;
          if (code !== 0) {
            console.error(`[claude-code] exit ${code}:`, stderr.trim() || fullText.trim());
            reject(new Error(`Claude Code CLI exited with code ${code}`));
            return;
          }
          resolve({ text: fullText.trim(), model: this.model });
        });

        child.on('error', (err) => {
          clearTimeout(timeout);
          if (settled) return;
          settled = true;
          reject(
            new Error(
              `Failed to run Claude Code CLI: ${err.message}. Is 'claude' installed and in PATH?`,
            ),
          );
        });
      });
    } catch (err) {
      if (!forceClean && this.hasInjectedKey() &&
          err instanceof Error && ClaudeCodeProvider.INVALID_KEY_RE.test(err.message)) {
        return this.runStream(messages, onChunk, true);
      }
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Claude Code CLI — installation test
// ---------------------------------------------------------------------------
export function testClaudeCode(): Promise<{ installed: boolean; version: string }> {
  return new Promise((resolve) => {
    const child = spawn('claude', ['--version'], {
      shell: IS_WIN ? process.env.ComSpec || 'cmd.exe' : false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.on('close', (code) => {
      resolve(code === 0 ? { installed: true, version: stdout.trim() } : { installed: false, version: '' });
    });

    child.on('error', () => {
      resolve({ installed: false, version: '' });
    });
  });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
export function createProvider(
  name: string,
  apiKey?: string,
  options?: { model?: string; ollamaUrl?: string; token?: string | undefined; allowLan?: boolean },
): AIProvider {
  const model = options?.model;
  switch (name) {
    case 'anthropic':
      if (!apiKey) throw new Error('Anthropic requires an API key');
      return new AnthropicProvider(apiKey, model);
    case 'openai':
      if (!apiKey) throw new Error('OpenAI requires an API key');
      return new OpenAIProvider(apiKey, model);
    case 'google':
      if (!apiKey) throw new Error('Google requires an API key');
      return new GoogleProvider(apiKey, model);
    case 'ollama':
      return new OllamaProvider(options?.ollamaUrl, model, options?.allowLan);
    case 'claude-code':
      return new ClaudeCodeProvider(apiKey, options?.token, model);
    default:
      throw new Error(`Unknown provider: ${name}`);
  }
}
