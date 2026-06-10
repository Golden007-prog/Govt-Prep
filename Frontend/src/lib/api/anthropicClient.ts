import { getSettings } from '../store/settings';
import { ENV } from '../config/env';

/**
 * The app's single AI gateway. Two transports behind one API:
 *
 *  - LOCAL mode (Subscription OAuth): requests go to the local backend
 *    (`POST ${ENV.localBackendUrl}/claude`), which runs `claude -p` with the
 *    user's Claude SUBSCRIPTION (CLI login or `claude setup-token`). No API key.
 *  - HOSTED mode (BYOK fallback): direct browser → api.anthropic.com with the
 *    user's key from localStorage and the mandatory
 *    `anthropic-dangerous-direct-browser-access: true` header (AGENTS.md).
 *
 * Mode comes from settings.activeMode, kept in sync with backend detection by
 * App. Keep calls LEAN and BATCHED: one call should return as much of a study
 * unit (notes + quiz + homework + cards) as possible.
 */

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

export class AnthropicError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'AnthropicError';
    this.status = status;
  }
}

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ClaudeRequest {
  model: string;
  system?: string;
  messages: ClaudeMessage[];
  maxTokens: number;
  temperature?: number;
  /** Override the stored key (e.g. the Setup screen connection test). */
  apiKey?: string;
  signal?: AbortSignal;
}

function resolveKey(override?: string): string {
  const key = override ?? getSettings().anthropicApiKey;
  if (!key) {
    throw new AnthropicError(0, 'No Anthropic API key configured — add one in Setup.');
  }
  return key;
}

function friendlyError(status: number, raw: string): string {
  switch (status) {
    case 401:
      return 'Anthropic API key is invalid or revoked — update it in Setup.';
    case 403:
      return 'This API key is not permitted to call the Anthropic API from a browser.';
    case 429:
      return 'Anthropic rate limit reached — wait a moment and try again.';
    case 529:
      return 'Anthropic API is overloaded — retry shortly.';
    default:
      return raw || `Anthropic API error (status ${status})`;
  }
}

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    'x-api-key': apiKey,
    'anthropic-version': API_VERSION,
    'content-type': 'application/json',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

// ---------------------------------------------------------------------------
// Local transport: Claude subscription via the backend's `claude -p` runner.
// ---------------------------------------------------------------------------

/** True when the app is in local mode (backend detected) and no explicit key override is in play. */
function viaLocalTransport(req: ClaudeRequest): boolean {
  return !req.apiKey && getSettings().activeMode === 'local';
}

/** Flatten a messages array into a single prompt for `claude -p` (print mode takes one prompt). */
function flattenForCli(messages: ClaudeMessage[]): string {
  if (messages.length === 1 && messages[0].role === 'user') return messages[0].content;
  const parts = messages.map((m) => (m.role === 'user' ? `User: ${m.content}` : `Assistant: ${m.content}`));
  parts.push('Assistant:');
  return parts.join('\n\n');
}

async function localComplete(req: ClaudeRequest): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${ENV.localBackendUrl}/claude`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: req.signal,
      body: JSON.stringify({
        prompt: flattenForCli(req.messages),
        ...(req.system ? { system: req.system } : {}),
        model: req.model,
      }),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new AnthropicError(
      0,
      'Local backend unreachable — is `npm run dev` (or the desktop app) running? Re-detect the mode from the header badge.',
    );
  }
  if (!response.ok) {
    const err = await response.json().catch(() => null);
    throw new AnthropicError(
      response.status,
      typeof err?.error === 'string' ? err.error : `Local Claude backend error (status ${response.status})`,
    );
  }
  const data = await response.json().catch(() => null);
  return typeof data?.text === 'string' ? data.text : '';
}

/** One non-streaming completion; returns the concatenated text blocks plus the stop reason. */
async function claudeCompleteRaw(req: ClaudeRequest): Promise<{ text: string; stopReason: string | null }> {
  const apiKey = resolveKey(req.apiKey);
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: buildHeaders(apiKey),
    signal: req.signal,
    body: JSON.stringify({
      model: req.model,
      max_tokens: req.maxTokens,
      ...(req.system ? { system: req.system } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      messages: req.messages,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => null);
    throw new AnthropicError(response.status, friendlyError(response.status, err?.error?.message ?? ''));
  }

  const data = await response.json();
  const blocks: Array<{ type: string; text?: string }> = data?.content ?? [];
  const text = blocks
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
  return { text, stopReason: data?.stop_reason ?? null };
}

/** One non-streaming completion; returns the concatenated text blocks. */
export async function claudeComplete(req: ClaudeRequest): Promise<string> {
  if (viaLocalTransport(req)) return localComplete(req);
  return (await claudeCompleteRaw(req)).text;
}

/**
 * Streaming completion (SSE). Calls `onText` per text delta and resolves with the
 * full text plus the stop reason (so callers can flag max_tokens truncation).
 * Used by the doubt-solver chat for responsive UX.
 */
export async function claudeStream(
  req: ClaudeRequest,
  onText: (delta: string) => void,
): Promise<{ text: string; stopReason: string | null }> {
  // The CLI transport has no token streaming — deliver the full text in one delta.
  if (viaLocalTransport(req)) {
    const text = await localComplete(req);
    if (text) onText(text);
    return { text, stopReason: null };
  }
  const apiKey = resolveKey(req.apiKey);
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: buildHeaders(apiKey),
    signal: req.signal,
    body: JSON.stringify({
      model: req.model,
      max_tokens: req.maxTokens,
      stream: true,
      ...(req.system ? { system: req.system } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      messages: req.messages,
    }),
  });

  if (!response.ok || !response.body) {
    const err = await response.json().catch(() => null);
    throw new AnthropicError(response.status, friendlyError(response.status, err?.error?.message ?? ''));
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let stopReason: string | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const event = JSON.parse(payload);
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          full += event.delta.text;
          onText(event.delta.text);
        }
        if (event.type === 'message_delta' && event.delta?.stop_reason) {
          stopReason = event.delta.stop_reason;
        }
        if (event.type === 'error') {
          throw new AnthropicError(0, event.error?.message ?? 'Stream error');
        }
      } catch (e) {
        if (e instanceof AnthropicError) throw e;
        // Ignore partial/non-JSON keepalive lines.
      }
    }
  }
  return { text: full, stopReason };
}

/**
 * Completion that must return a JSON document. Strips markdown fences and
 * extracts the outermost JSON value, then parses. Throws AnthropicError on
 * truncated (max_tokens) or unparseable output so callers can retry/surface cleanly.
 */
export async function claudeJson<T>(req: ClaudeRequest): Promise<T> {
  let text: string;
  if (viaLocalTransport(req)) {
    text = await localComplete(req);
  } else {
    const raw = await claudeCompleteRaw(req);
    if (raw.stopReason === 'max_tokens') {
      throw new AnthropicError(
        0,
        'The AI response was cut off by the output token limit — try again or pick a narrower topic.',
      );
    }
    text = raw.text;
  }
  // Fast path: model obeyed "STRICT JSON only" — never mangle a valid payload.
  try {
    return JSON.parse(text.trim()) as T;
  } catch {
    /* fall through to extraction */
  }
  const cleaned = extractJson(text);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new AnthropicError(0, 'Model returned malformed JSON — please retry.');
  }
}

function extractJson(text: string): string {
  let t = text.trim();
  // Strip a fence only when it wraps the entire payload (anchored; trailing
  // anchor forces the capture to extend past any inner ``` to the final one).
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/);
  if (fence) t = fence[1].trim();
  // Scan from the first { or [ to its balanced close, respecting strings/escapes.
  const start = t.search(/[{[]/);
  if (start === -1) return t;
  const open = t[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) return t.slice(start, i + 1);
    }
  }
  return t.slice(start); // unbalanced — let JSON.parse report the failure
}

/** Cheap key validation used by the Setup connection test. */
export async function testAnthropicKey(apiKey: string, model: string): Promise<void> {
  await claudeComplete({
    model,
    apiKey,
    maxTokens: 1,
    messages: [{ role: 'user', content: 'Ping' }],
  });
}

/**
 * End-to-end test of the local SUBSCRIPTION brain (Setup connection test):
 * backend reachable AND `claude -p` signed in. Throws AnthropicError otherwise.
 */
export async function testLocalBrain(model: string): Promise<void> {
  await localComplete({
    model,
    maxTokens: 8,
    messages: [{ role: 'user', content: 'Reply with the single word: pong' }],
  });
}
