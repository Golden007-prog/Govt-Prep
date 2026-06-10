import Fastify from 'fastify';
import cors from '@fastify/cors';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Env: load Backend/.env (KEY=VALUE lines) without a dotenv dependency.
// CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`) enables headless
// subscription auth; with it unset the CLI uses your interactive login.
// ---------------------------------------------------------------------------
try {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), '.env');
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[2] && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch {
  // No .env is fine — the claude CLI login session is the default auth.
}

const fastify = Fastify({
  logger: true
});

// CORS allowlist: the dev server and the deployed Pages origin (which pings
// localhost:8787/health for mode detection). Origins are scheme://host[:port] — no path.
await fastify.register(cors, {
  origin: [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://golden007-prog.github.io',
  ],
});

// Health check endpoint
fastify.get('/health', async () => {
  return { status: 'ok', mode: 'local', brain: 'claude-subscription' };
});

// ---------------------------------------------------------------------------
// Subscription brain: spawn `claude -p --output-format json` per request.
// The user's Claude subscription (CLI login or CLAUDE_CODE_OAUTH_TOKEN) pays —
// never an API key: ANTHROPIC_API_KEY is stripped from the child env so the
// CLI cannot silently fall back to API billing.
// ---------------------------------------------------------------------------

const MODEL_RE = /^[a-z0-9.-]+$/i;
const CLAUDE_TIMEOUT_MS = 180_000;
const MAX_CONCURRENT = 2;
let inFlight = 0;

interface RunOpts {
  prompt: string;
  model?: string;
  onCancel?: (kill: () => void) => void;
}

function runClaude({ prompt, model, onCancel }: RunOpts): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'json'];
    if (model && MODEL_RE.test(model)) args.push('--model', model);

    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY; // subscription only — no API-key fallback

    // shell:true lets Windows resolve claude.cmd. All argv tokens are static or
    // regex-validated; the prompt itself only ever travels via stdin.
    const child = spawn('claude', args, {
      shell: process.platform === 'win32',
      windowsHide: true,
      env,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error('Claude CLI timed out after 180s')));
    }, CLAUDE_TIMEOUT_MS);

    onCancel?.(() => {
      child.kill();
      finish(() => reject(new Error('Request cancelled')));
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      finish(() =>
        reject(
          new Error(
            err.code === 'ENOENT'
              ? 'Claude CLI not found — install Claude Code and sign in (or set CLAUDE_CODE_OAUTH_TOKEN in Backend/.env).'
              : `Failed to start claude CLI: ${err.message}`,
          ),
        ),
      );
    });

    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });

    child.on('close', (code) => {
      finish(() => {
        if (code !== 0 && !stdout.trim()) {
          reject(
            new Error(
              stderr.trim().slice(0, 500) ||
                `claude CLI exited with code ${code} — is your subscription signed in? Run \`claude\` once, or \`claude setup-token\`.`,
            ),
          );
          return;
        }
        try {
          const parsed = JSON.parse(stdout);
          if (parsed?.is_error) {
            reject(new Error(String(parsed.result ?? 'claude CLI reported an error')));
            return;
          }
          resolve(typeof parsed?.result === 'string' ? parsed.result : '');
        } catch {
          // Older CLI versions may emit plain text in -p mode.
          if (stdout.trim()) resolve(stdout.trim());
          else reject(new Error('claude CLI returned no parseable output'));
        }
      });
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

interface ClaudeBody {
  prompt?: string;
  system?: string;
  model?: string;
}

// Subscription completion: { prompt, system?, model? } → { text }.
// Keep calls lean and batched (AGENTS.md) — one call per study unit.
fastify.post('/claude', async (request, reply) => {
  const body = (request.body ?? {}) as ClaudeBody;
  if (typeof body.prompt !== 'string' || body.prompt.trim().length === 0) {
    return reply.status(400).send({ error: 'prompt (non-empty string) is required' });
  }
  if (body.prompt.length > 200_000) {
    return reply.status(413).send({ error: 'prompt too large' });
  }
  if (inFlight >= MAX_CONCURRENT) {
    return reply.status(429).send({ error: 'Too many concurrent AI calls — try again in a moment.' });
  }

  const fullPrompt = body.system
    ? `SYSTEM INSTRUCTIONS (follow these strictly for this task):\n${body.system}\n\n---\n\n${body.prompt}`
    : body.prompt;

  inFlight++;
  try {
    const text = await runClaude({
      prompt: fullPrompt,
      model: typeof body.model === 'string' ? body.model : undefined,
      // Client-disconnect detection: IncomingMessage 'close' fires on normal body
      // completion, so listen on the RESPONSE — a close before writableFinished
      // means the browser aborted (e.g. chat Stop button) → kill the CLI run.
      onCancel: (kill) =>
        reply.raw.on('close', () => {
          if (!reply.raw.writableFinished) kill();
        }),
    });
    return { text };
  } catch (err) {
    request.log.error(err);
    return reply.status(502).send({ error: err instanceof Error ? err.message : 'claude CLI failed' });
  } finally {
    inFlight--;
  }
});

// Stub for YouTube transcript download (M3 — local-mode lecture grounding)
fastify.get('/transcript', async (_request, reply) => {
  return reply.status(501).send({ error: 'Transcript downloader not implemented yet.' });
});

const start = async () => {
  try {
    // Listen on localhost, port 8787 as specified in the prompt
    await fastify.listen({ port: 8787, host: '127.0.0.1' });
    console.log('Backend Fastify server is running on http://127.0.0.1:8787');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
