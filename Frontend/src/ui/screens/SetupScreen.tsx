import React, { useState } from 'react';
import { getSettings, saveSettings, MODEL_CONFIG } from '../../lib/store/settings';
import { type AppMode, detectAppMode } from '../../lib/api/modeDetect';
import { testAnthropicKey, AnthropicError } from '../../lib/api/anthropicClient';

interface SetupScreenProps {
  mode: AppMode;
  onSetupComplete: () => void;
}

type TestState = 'idle' | 'testing' | 'success' | 'error';

/**
 * Claude-only setup (architecture v3): one step — the Anthropic API key (BYOK).
 * Local mode needs nothing (the backend brings its own credentials); the key is
 * still accepted there as an optional fallback. No Gemini/Google keys anywhere.
 */
export const SetupScreen: React.FC<SetupScreenProps> = ({ mode, onSetupComplete }) => {
  const [anthropicKey, setAnthropicKey] = useState(() => getSettings().anthropicApiKey || '');
  const [claudeToken, setClaudeToken] = useState(() => getSettings().localClaudeToken || '');

  const [testState, setTestState] = useState<TestState>('idle');
  const [testMessage, setTestMessage] = useState('');

  const handleTest = async () => {
    setTestState('testing');
    setTestMessage(mode === 'local' ? 'Pinging local backend…' : 'Verifying Anthropic key…');

    if (mode === 'local') {
      try {
        const detected = await detectAppMode();
        if (detected === 'local') {
          setTestState('success');
          setTestMessage('Backend server active and responsive.');
          saveSettings({ localClaudeToken: claudeToken });
        } else {
          setTestState('error');
          setTestMessage('Could not reach backend on http://localhost:8787.');
        }
      } catch {
        setTestState('error');
        setTestMessage('Backend server check failed.');
      }
      return;
    }

    if (!anthropicKey) {
      setTestState('error');
      setTestMessage('Please enter your Anthropic API key.');
      return;
    }
    try {
      await testAnthropicKey(anthropicKey, MODEL_CONFIG.claudeModel);
      setTestState('success');
      setTestMessage('Anthropic key verified successfully!');
      saveSettings({ anthropicApiKey: anthropicKey });
    } catch (err) {
      setTestState('error');
      setTestMessage(
        err instanceof AnthropicError && err.status !== 0
          ? err.message
          : 'Network error connecting to the Anthropic API.',
      );
    }
  };

  const handleComplete = () => {
    saveSettings({ anthropicApiKey: anthropicKey, localClaudeToken: claudeToken });
    onSetupComplete();
  };

  const canComplete = mode === 'local' || !!anthropicKey;

  return (
    <div className="max-w-md mx-auto my-12 px-4 sm:px-6">
      <div className="text-center mb-8">
        <span className="text-xs font-semibold tracking-wider text-cyan-400 uppercase font-sans">
          Welcome to GovPrep
        </span>
        <h2 className="text-3xl font-extrabold tracking-tight text-white font-display mt-2">
          Setup Study Companion
        </h2>
        <p className="text-sm text-slate-400 mt-2">
          Every AI feature — notes, quizzes, grading, flashcards, mocks — runs on Claude.
        </p>
      </div>

      <div className="space-y-6">
        <div className="glass-panel p-6 space-y-4">
          <h3 className="text-lg font-bold text-white font-display flex items-center gap-2">
            <span>🧠</span> Configure AI Brain
          </h3>

          {mode === 'local' ? (
            <div className="space-y-4">
              <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                <div className="flex gap-2">
                  <span className="text-lg">💻</span>
                  <div>
                    <p className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Local Backend Active</p>
                    <p className="text-xs text-slate-300 mt-1">
                      GovPrep routes requests through your local backend — no key required in the browser.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Local Access Token (Optional)
                </label>
                <input
                  type="password"
                  placeholder="Enter setup token (if custom)"
                  value={claudeToken}
                  onChange={(e) => setClaudeToken(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700/50 rounded-xl px-4 py-2.5 text-slate-200 focus:outline-none focus:border-cyan-500 transition-colors"
                />
                <p className="text-[10px] text-slate-500">
                  Only required if your local daemon requires custom token authentication.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-3.5 bg-cyan-500/10 border border-cyan-500/20 rounded-xl">
                <div className="flex gap-2">
                  <span className="text-lg">🌐</span>
                  <div>
                    <p className="text-xs font-bold text-cyan-400 uppercase tracking-wider">Hosted Mode (Browser Only)</p>
                    <p className="text-xs text-slate-300 mt-1">
                      Bring your own Anthropic API key. Requests go directly from your browser to Anthropic —
                      the key never touches any server of ours.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Anthropic API Key
                </label>
                <input
                  type="password"
                  placeholder="sk-ant-..."
                  value={anthropicKey}
                  onChange={(e) => setAnthropicKey(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700/50 rounded-xl px-4 py-2.5 text-slate-200 focus:outline-none focus:border-cyan-500 transition-colors"
                />
                <p className="text-[10px] text-slate-500">
                  Stored on-device in localStorage. Tip: set a low monthly spend cap on this key at
                  console.anthropic.com.
                </p>
              </div>
            </div>
          )}

          {testState !== 'idle' && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                testState === 'testing'
                  ? 'bg-slate-800/40 border-slate-700 text-slate-300'
                  : testState === 'success'
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                    : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
              }`}
            >
              {testState === 'testing' && (
                <span className="animate-spin inline-block w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full" />
              )}
              {testState === 'success' && <span>✅</span>}
              {testState === 'error' && <span>❌</span>}
              <p className="leading-tight">{testMessage}</p>
            </div>
          )}

          <button onClick={handleTest} disabled={testState === 'testing'} className="w-full btn-secondary text-sm">
            Test Connection
          </button>
        </div>

        <div className="flex justify-end">
          <button
            onClick={handleComplete}
            disabled={!canComplete}
            className="btn-success text-sm flex items-center gap-1.5 shadow-neon-green/10"
          >
            Launch Companion
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};
