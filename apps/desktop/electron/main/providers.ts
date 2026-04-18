import type { AIProvider, ChatMessage, ChatResponse } from '@code-review/core';
import { spawn, type ChildProcess } from 'node:child_process';
import { assertLocalUrl } from './validation.js';

const IS_WIN = process.platform === 'win32';

const VALID_MODEL_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/;

function combinedSignal(timeoutMs: number, external?: AbortSignal): AbortSignal {
  const timeoutSig = AbortSignal.timeout(timeoutMs);
  if (!external) return timeoutSig;
  return AbortSignal.any([timeoutSig, external]);
}

/**
 * Two-phase watchdog: a short `connectMs` window during which the caller must
 * call `reset()` (we call it right after `await fetch(...)` resolves, i.e.
 * response headers received). From then on, a longer `idleMs` window applies
 * — reset on each chunk so it only fires during true silence. `external`
 * aborts are mirrored so one signal covers connect-hang, mid-stream silence,
 * and caller cancellation. Call `dispose()` on any exit path to clear timers.
 */
function idleAbortSignal(
  idleMs: number,
  external?: AbortSignal,
  connectMs?: number,
): { signal: AbortSignal; reset: () => void; dispose: () => void } {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const arm = (ms: number, phase: 'connect' | 'idle') => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const label = phase === 'connect'
        ? `Connect phase timeout (${ms}ms — server did not send headers)`
        : `Stream idle for ${ms}ms (no data received)`;
      ctrl.abort(new DOMException(label, 'TimeoutError'));
    }, ms);
  };

  const reset = () => arm(idleMs, 'idle');

  const onExt = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    ctrl.abort((external as AbortSignal).reason);
  };
  if (external) {
    if (external.aborted) {
      onExt();
    } else {
      external.addEventListener('abort', onExt, { once: true });
    }
  }

  // Only arm the phase timer if the controller isn't already aborted.
  // When `external.aborted === true` at entry, onExt() above already aborted
  // `ctrl`; arming a fresh setTimeout on an aborted controller would leak a
  // live timer until it fires (its abort() would be a no-op but the timer
  // handle is still pending in the event loop, blocking clean process exit
  // for up to `connectMs`/`idleMs`).
  if (!ctrl.signal.aborted) {
    if (connectMs !== undefined) {
      arm(connectMs, 'connect');
    } else {
      arm(idleMs, 'idle');
    }
  }

  const dispose = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (external) external.removeEventListener('abort', onExt);
  };
  return { signal: ctrl.signal, reset, dispose };
}

/**
 * Kill a spawned child process AND its descendants. `child.kill()` on Windows
 * only signals the immediate cmd.exe wrapper, leaving the real CLI grandchild
 * running; taskkill /T walks the tree. On POSIX the direct signal suffices
 * because the shell relays it to the leaf.
 */
function killProcessTree(child: ChildProcess): void {
  if (IS_WIN && typeof child.pid === 'number') {
    try {
      const pid = child.pid;
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      killer.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
      killer.on('error', () => { try { child.kill(); } catch { /* ignore */ } });
      killer.on('exit', (code) => {
        // 128 = process not found (already gone). 0 = killed successfully.
        // Anything else means taskkill failed; the grandchild may still run.
        if (code !== 0 && code !== 128 && code !== null) {
          console.warn(`[killProcessTree] taskkill pid=${pid} exit=${code}: ${stderr.trim()}`);
        }
      });
      return;
    } catch {
      // fall through to direct kill
    }
  }
  try { child.kill(); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Error helper — never expose raw API response bodies to the renderer.
// ---------------------------------------------------------------------------

/** Parse a Retry-After header per RFC 7231 §7.1.3: delta-seconds OR HTTP-date. */
function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (!trimmed) return undefined;
  const asSeconds = Number(trimmed);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.min(asSeconds * 1000, 60_000);
  }
  const asDate = Date.parse(trimmed);
  if (Number.isFinite(asDate)) {
    const delta = asDate - Date.now();
    if (delta > 0) return Math.min(delta, 60_000);
  }
  return undefined;
}

/**
 * Cap error body logging. Providers sometimes echo request fragments
 * (prompts, model, account IDs) or rate-limit detail that may contain user
 * code snippets; in a packaged Electron build these logs can surface in
 * crash reports or user-collected diagnostics. Keep only a short preview
 * by default, and only emit the fuller body when explicitly opted-in via
 * CODESCOPE_VERBOSE_API_ERRORS=1.
 */
const API_ERROR_BODY_PREVIEW_CHARS = 512;

async function safeApiError(providerLabel: string, status: number, res: Response): Promise<Error> {
  const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
  const retrySuffix = retryAfterMs !== undefined ? ` (retry-after ${retryAfterMs}ms)` : '';
  try {
    const body = await res.text();
    const verbose = process.env.CODESCOPE_VERBOSE_API_ERRORS === '1';
    if (verbose) {
      console.error(`[${providerLabel}] HTTP ${status}${retrySuffix} body:`, body);
    } else {
      const preview = body.length > API_ERROR_BODY_PREVIEW_CHARS
        ? body.slice(0, API_ERROR_BODY_PREVIEW_CHARS) + `…(+${body.length - API_ERROR_BODY_PREVIEW_CHARS} chars)`
        : body;
      console.error(`[${providerLabel}] HTTP ${status}${retrySuffix} (${body.length}B body preview):`, preview);
    }
  } catch {
    console.error(`[${providerLabel}] HTTP ${status}${retrySuffix} (body unavailable)`);
  }
  const err = new Error(`${providerLabel} request failed with status ${status}`) as
    Error & { retryAfterMs?: number };
  if (retryAfterMs !== undefined) err.retryAfterMs = retryAfterMs;
  return err;
}

// ---------------------------------------------------------------------------
// Line-based stream parser — buffers partial lines across chunk boundaries.
// Used for both SSE (Anthropic/OpenAI/Google) and NDJSON (Ollama) streams.
// ---------------------------------------------------------------------------
async function parseLineStream(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
  onData?: () => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      onData?.();
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

  async chat(messages: ChatMessage[], signal?: AbortSignal): Promise<ChatResponse> {
    const system = messages.find((m) => m.role === 'system')?.content ?? '';
    const userMessages = messages.filter((m) => m.role !== 'system');

    // Two-phase watchdog: 30s to receive response headers (connect phase),
    // then a generous 10-min body-read budget. A flat 30s would fire mid-body
    // on legitimate long completions (large reviews can take minutes).
    const idle = idleAbortSignal(600_000, signal, 30_000);
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: idle.signal,
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
      idle.reset();

      if (!res.ok) throw await safeApiError('Anthropic', res.status, res);
      const data = await res.json() as AnthropicChatResponse;
      const block = data.content[0];
      if (!block) throw new Error('Anthropic: empty response content');
      return {
        text: block.text,
        model: data.model,
        tokensUsed: { input: data.usage.input_tokens, output: data.usage.output_tokens },
      };
    } finally {
      idle.dispose();
    }
  }

  async stream(
    messages: ChatMessage[],
    onChunk: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<ChatResponse> {
    const system = messages.find((m) => m.role === 'system')?.content ?? '';
    const userMessages = messages.filter((m) => m.role !== 'system');

    const idle = idleAbortSignal(120_000, signal, 30_000);
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: idle.signal,
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
      idle.reset();

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
      }, idle.reset);

      return { text: fullText, model: this.model, tokensUsed: { input: inputTokens, output: outputTokens } };
    } finally {
      idle.dispose();
    }
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

  async chat(messages: ChatMessage[], signal?: AbortSignal): Promise<ChatResponse> {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: combinedSignal(30_000, signal),
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

  async stream(
    messages: ChatMessage[],
    onChunk: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<ChatResponse> {
    const idle = idleAbortSignal(120_000, signal, 30_000);
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal: idle.signal,
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
      idle.reset();

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
      }, idle.reset);

      return { text: fullText, model: this.model, tokensUsed: { input: inputTokens, output: outputTokens } };
    } finally {
      idle.dispose();
    }
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

  async chat(messages: ChatMessage[], signal?: AbortSignal): Promise<ChatResponse> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    const body: Record<string, unknown> = { contents: this.toGeminiMessages(messages) };
    const si = this.systemInstruction(messages);
    if (si) body.systemInstruction = si;

    const res = await fetch(url, {
      method: 'POST',
      signal: combinedSignal(30_000, signal),
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

  async stream(
    messages: ChatMessage[],
    onChunk: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<ChatResponse> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:streamGenerateContent?alt=sse`;
    const body: Record<string, unknown> = { contents: this.toGeminiMessages(messages) };
    const si = this.systemInstruction(messages);
    if (si) body.systemInstruction = si;

    const idle = idleAbortSignal(120_000, signal, 30_000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: idle.signal,
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify(body),
      });
      idle.reset();

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
      }, idle.reset);

      return { text: fullText, model: this.model, tokensUsed: { input: inputTokens, output: outputTokens } };
    } finally {
      idle.dispose();
    }
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

  async chat(messages: ChatMessage[], signal?: AbortSignal): Promise<ChatResponse> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      signal: combinedSignal(30_000, signal),
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

  async stream(
    messages: ChatMessage[],
    onChunk: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<ChatResponse> {
    // Ollama is local — skip connect-phase guard (loopback fetch is effectively
    // instant; the process itself can legitimately take minutes to load a model
    // before the first byte, so we rely on the idle window).
    const idle = idleAbortSignal(120_000, signal);
    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        signal: idle.signal,
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
      }, idle.reset);

      return { text: fullText, model: this.model, tokensUsed: { input: inputTokens, output: outputTokens } };
    } finally {
      idle.dispose();
    }
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

  /**
   * Whether `key` is a user API key safe to inject via ANTHROPIC_API_KEY.
   * Fails CLOSED: any unrecognised `sk-ant-*` variant (new OAuth/session prefix
   * Anthropic might introduce) is treated as "not an API key" so we don't
   * accidentally leak an OAuth token into the CLI's API-key path.
   * Known prefixes as of 2025-04:
   *   sk-ant-api…  user API key — inject
   *   sk-ant-oat…  OAuth access token — do NOT inject (CLI handles OAuth)
   *   sk-ant-sid…  session identifier — do NOT inject
   */
  private static isApiKey(key: string): boolean {
    if (key.startsWith('sk-ant-api')) return true;
    if (key.startsWith('sk-ant-')) return false;
    if (key.startsWith('sk-')) return true;
    return false;
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

  async chat(messages: ChatMessage[], signal?: AbortSignal): Promise<ChatResponse> {
    return this.runChat(messages, false, signal);
  }

  private async runChat(
    messages: ChatMessage[],
    forceClean: boolean,
    signal?: AbortSignal,
  ): Promise<ChatResponse> {
    const prompt = this.buildPrompt(messages);
    const env = this.buildEnv(forceClean);
    const args = ['-p', '--model', this.model];

    try {
      return await new Promise<ChatResponse>((resolve, reject) => {
        const child = this.spawnClaude(args, env);

        let stdout = '';
        let stderr = '';
        let settled = false;

        // Idle timeout — resets on any stdout/stderr activity. A hard deadline
        // can't distinguish "hung" from "reviewing a large project", so we use
        // a longer idle window instead. `claude -p` buffers all stdout until
        // close, so in practice the idle window acts as a hard deadline for
        // the whole run; whole-project reviews need generous headroom.
        // Declared before onAbort to avoid TDZ when signal is already aborted
        // at entry.
        const IDLE_TIMEOUT = 900_000;
        const IDLE_TIMEOUT_MIN = Math.round(IDLE_TIMEOUT / 60000);
        let timeout: ReturnType<typeof setTimeout> | null = null;
        const onTimeout = () => {
          if (settled) return;
          settled = true;
          if (signal) signal.removeEventListener('abort', onAbort);
          killProcessTree(child);
          reject(new Error(`Claude Code CLI timed out (no output for ${IDLE_TIMEOUT_MIN} minutes)`));
        };
        const resetTimeout = () => {
          if (timeout) clearTimeout(timeout);
          timeout = setTimeout(onTimeout, IDLE_TIMEOUT);
        };

        const onAbort = () => {
          if (settled) return;
          settled = true;
          if (timeout) { clearTimeout(timeout); timeout = null; }
          killProcessTree(child);
          reject(new Error('Review cancelled'));
        };
        if (signal) {
          if (signal.aborted) { onAbort(); return; }
          signal.addEventListener('abort', onAbort, { once: true });
        }

        resetTimeout();

        child.stdout.on('data', (data: Buffer) => {
          resetTimeout();
          stdout += data.toString();
        });
        child.stderr.on('data', (data: Buffer) => {
          resetTimeout();
          stderr += data.toString();
        });

        child.stdin.write(prompt);
        child.stdin.end();

        child.on('close', (code) => {
          if (timeout) { clearTimeout(timeout); timeout = null; }
          if (signal) signal.removeEventListener('abort', onAbort);
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
          if (timeout) { clearTimeout(timeout); timeout = null; }
          if (signal) signal.removeEventListener('abort', onAbort);
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
        return this.runChat(messages, true, signal);
      }
      throw err;
    }
  }

  async stream(
    messages: ChatMessage[],
    onChunk: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<ChatResponse> {
    return this.runStream(messages, onChunk, false, signal);
  }

  private async runStream(
    messages: ChatMessage[],
    onChunk: (text: string) => void,
    forceClean: boolean,
    signal?: AbortSignal,
  ): Promise<ChatResponse> {
    const prompt = this.buildPrompt(messages);
    const env = this.buildEnv(forceClean);
    // `--output-format stream-json --verbose` makes `claude -p` emit one
    // NDJSON event per line AS the model generates, instead of buffering
    // the full reply until close. The flags are required together by the
    // CLI. If the installed CLI predates stream-json, the run falls back
    // to single-emit on close.
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--model', this.model];

    try {
      return await new Promise<ChatResponse>((resolve, reject) => {
        const child = this.spawnClaude(args, env);

        let lineBuffer = '';
        let rawStdout = '';
        let stderr = '';
        let settled = false;

        // Per-line streaming state. Any valid NDJSON event we parse enables
        // streaming mode (emit deltas live). If nothing parses, we fall
        // back to the legacy path on close: unwrap {"result":"..."} envelope
        // and emit once.
        let streamedText = '';
        let finalResult: string | null = null;
        let anyEventsParsed = false;

        // Idle timeout — resets on any CLI activity and on every parsed
        // NDJSON line. Stderr counts too because the CLI emits progress
        // there during long first-token latency. 15 minutes is generous
        // enough for whole-project reviews.
        const IDLE_TIMEOUT = 900_000;
        const IDLE_TIMEOUT_MIN = Math.round(IDLE_TIMEOUT / 60000);
        let timeout: ReturnType<typeof setTimeout> | null = null;
        const onTimeout = () => {
          if (settled) return;
          settled = true;
          if (signal) signal.removeEventListener('abort', onAbort);
          killProcessTree(child);
          reject(new Error(`Claude Code CLI timed out (no output for ${IDLE_TIMEOUT_MIN} minutes)`));
        };
        const resetTimeout = () => {
          if (timeout) clearTimeout(timeout);
          timeout = setTimeout(onTimeout, IDLE_TIMEOUT);
        };

        const onAbort = () => {
          if (settled) return;
          settled = true;
          if (timeout) { clearTimeout(timeout); timeout = null; }
          killProcessTree(child);
          reject(new Error('Review cancelled'));
        };
        if (signal) {
          if (signal.aborted) { onAbort(); return; }
          signal.addEventListener('abort', onAbort, { once: true });
        }

        resetTimeout();

        const safeEmit = (delta: string): void => {
          if (!delta) return;
          try { onChunk(delta); } catch { /* renderer may have torn down */ }
        };

        const extractAssistantText = (ev: Record<string, unknown>): string | null => {
          const message = ev.message;
          if (!message || typeof message !== 'object') return null;
          const content = (message as { content?: unknown }).content;
          if (!Array.isArray(content)) return null;
          let out = '';
          for (const block of content) {
            if (block && typeof block === 'object'
                && (block as { type?: unknown }).type === 'text'
                && typeof (block as { text?: unknown }).text === 'string') {
              out += (block as { text: string }).text;
            }
          }
          return out;
        };

        const handleLine = (line: string): void => {
          const trimmed = line.trim();
          if (!trimmed) return;
          let event: unknown;
          try { event = JSON.parse(trimmed); } catch { return; }
          if (!event || typeof event !== 'object') return;
          anyEventsParsed = true;
          resetTimeout();

          const ev = event as Record<string, unknown>;
          const type = ev.type;

          // Partial-delta format — emit each text_delta as it arrives.
          if (type === 'stream_event') {
            const inner = ev.event as
              { type?: string; delta?: { type?: string; text?: unknown } } | undefined;
            if (inner?.type === 'content_block_delta'
                && inner.delta?.type === 'text_delta'
                && typeof inner.delta.text === 'string') {
              streamedText += inner.delta.text;
              safeEmit(inner.delta.text);
            }
            return;
          }

          // Full-message assistant event — derive delta against what we've
          // already streamed, assuming prefix-monotonic growth.
          if (type === 'assistant') {
            const cumulative = extractAssistantText(ev);
            if (cumulative === null) return;
            if (cumulative.length > streamedText.length && cumulative.startsWith(streamedText)) {
              const delta = cumulative.slice(streamedText.length);
              streamedText = cumulative;
              safeEmit(delta);
            } else if (cumulative !== streamedText) {
              // Non-prefix divergence (rare; e.g. replaced draft). Emit replacement.
              streamedText = cumulative;
              safeEmit(cumulative);
            }
            return;
          }

          if (type === 'result' && typeof ev.result === 'string') {
            finalResult = ev.result;
          }
        };

        child.stdout.on('data', (data: Buffer) => {
          resetTimeout();
          const s = data.toString();
          rawStdout += s;
          lineBuffer += s;
          let nl = lineBuffer.indexOf('\n');
          while (nl !== -1) {
            const line = lineBuffer.slice(0, nl);
            lineBuffer = lineBuffer.slice(nl + 1);
            handleLine(line);
            nl = lineBuffer.indexOf('\n');
          }
        });
        child.stderr.on('data', (data: Buffer) => {
          resetTimeout();
          stderr += data.toString();
        });

        child.stdin.write(prompt);
        child.stdin.end();

        child.on('close', (code) => {
          if (timeout) { clearTimeout(timeout); timeout = null; }
          if (signal) signal.removeEventListener('abort', onAbort);
          if (settled) return;
          settled = true;

          // Drain any trailing partial line (servers sometimes omit final \n).
          if (lineBuffer.trim().length > 0) {
            handleLine(lineBuffer);
            lineBuffer = '';
          }

          if (code !== 0) {
            console.error(`[claude-code] exit ${code}:`, stderr.trim() || rawStdout.trim());
            reject(new Error(`Claude Code CLI exited with code ${code}`));
            return;
          }

          // Streaming mode — at least one NDJSON event landed.
          if (anyEventsParsed) {
            if (finalResult !== null
                && finalResult.length > streamedText.length
                && finalResult.startsWith(streamedText)) {
              safeEmit(finalResult.slice(streamedText.length));
              streamedText = finalResult;
            }
            const text = finalResult ?? streamedText;
            resolve({ text, model: this.model });
            return;
          }

          // Fallback: CLI output wasn't stream-json (older CLI, or the
          // --verbose/--output-format pair was rejected). Emit once on
          // close, preserving legacy {"result":"..."} envelope unwrapping.
          let emitted = rawStdout.trim();
          try {
            const parsed = JSON.parse(rawStdout) as Record<string, unknown>;
            if (typeof parsed.result === 'string') emitted = parsed.result;
          } catch {
            // stdout wasn't a JSON envelope — emit as-is.
          }
          safeEmit(emitted);
          resolve({ text: emitted, model: this.model });
        });

        child.on('error', (err) => {
          if (timeout) { clearTimeout(timeout); timeout = null; }
          if (signal) signal.removeEventListener('abort', onAbort);
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
        return this.runStream(messages, onChunk, true, signal);
      }
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Claude Code CLI — installation test
// ---------------------------------------------------------------------------
export function testClaudeCode(): Promise<{ installed: boolean; version: string }> {
  // Upper bound for `claude --version`. The real CLI prints version and exits
  // in well under a second; anything past this means a hung binary (PATH
  // collision with a same-named tool that opens a prompt, a stuck network
  // check, a misconfigured wrapper script, etc.). Without a timeout, the IPC
  // caller's promise would pend forever and the renderer's "Test connection"
  // button would spin indefinitely.
  const TIMEOUT_MS = 10_000;
  return new Promise((resolve) => {
    const child = spawn('claude', ['--version'], {
      shell: IS_WIN ? process.env.ComSpec || 'cmd.exe' : false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (result: { installed: boolean; version: string }) => {
      if (settled) return;
      settled = true;
      if (timer) { clearTimeout(timer); timer = null; }
      resolve(result);
    };
    timer = setTimeout(() => {
      if (settled) return;
      // Reap the descendant tree — on Windows `spawn('claude', …, { shell })`
      // goes through cmd.exe, so child.kill() would only signal the wrapper
      // and leave a hung claude.exe grandchild running.
      killProcessTree(child);
      finish({ installed: false, version: '' });
    }, TIMEOUT_MS);

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.on('close', (code) => {
      finish(code === 0 ? { installed: true, version: stdout.trim() } : { installed: false, version: '' });
    });

    child.on('error', () => {
      finish({ installed: false, version: '' });
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
