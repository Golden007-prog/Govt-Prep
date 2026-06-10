import { getSettings } from '../store/settings';

/**
 * Direct browser → api.anthropic.com client (BYOK). The user's key lives in
 * localStorage (Setup screen) and every request carries the mandatory
 * `anthropic-dangerous-direct-browser-access: true` header (AGENTS.md hard constraint).
 *
 * Keep calls LEAN and BATCHED: one call should return as much of a study unit
 * (notes + quiz + homework + cards) as possible.
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

/** One non-streaming completion; returns the concatenated text blocks. */
export async function claudeComplete(req: ClaudeRequest): Promise<string> {
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
  return blocks
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
}

/**
 * Streaming completion (SSE). Calls `onText` per text delta and resolves with the
 * full text. Used by the doubt-solver chat for responsive UX.
 */
export async function claudeStream(req: ClaudeRequest, onText: (delta: string) => void): Promise<string> {
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
        if (event.type === 'error') {
          throw new AnthropicError(0, event.error?.message ?? 'Stream error');
        }
      } catch (e) {
        if (e instanceof AnthropicError) throw e;
        // Ignore partial/non-JSON keepalive lines.
      }
    }
  }
  return full;
}

/**
 * Completion that must return a JSON document. Strips markdown fences and
 * extracts the outermost JSON value, then parses. Throws AnthropicError on
 * unparseable output so callers can retry/surface cleanly.
 */
export async function claudeJson<T>(req: ClaudeRequest): Promise<T> {
  const text = await claudeComplete(req);
  const cleaned = extractJson(text);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new AnthropicError(0, 'Model returned malformed JSON — please retry.');
  }
}

function extractJson(text: string): string {
  let t = text.trim();
  // Strip ```json ... ``` fences if present.
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  // Trim any prose before the first { or [ and after the matching close.
  const start = Math.min(...['{', '['].map((c) => (t.indexOf(c) === -1 ? Infinity : t.indexOf(c))));
  if (start !== Infinity && start > 0) t = t.slice(start);
  const lastBrace = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (lastBrace !== -1) t = t.slice(0, lastBrace + 1);
  return t;
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
