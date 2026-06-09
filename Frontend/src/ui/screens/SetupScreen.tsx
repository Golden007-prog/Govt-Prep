import React, { useState, useEffect } from 'react';
import { getSettings, saveSettings, MODEL_CONFIG } from '../../lib/store/settings';
import { type AppMode, detectAppMode } from '../../lib/api/modeDetect';

interface SetupScreenProps {
  mode: AppMode;
  onSetupComplete: () => void;
}

export const SetupScreen: React.FC<SetupScreenProps> = ({ mode, onSetupComplete }) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [anthropicKey, setAnthropicKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [claudeToken, setClaudeToken] = useState('');

  // Diagnostics states
  const [testState1, setTestState1] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage1, setTestMessage1] = useState('');
  const [testState2, setTestState2] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage2, setTestMessage2] = useState('');

  useEffect(() => {
    const settings = getSettings();
    setAnthropicKey(settings.anthropicApiKey || '');
    setGeminiKey(settings.geminiApiKey || '');
    setClaudeToken(settings.localClaudeToken || '');
  }, []);

  const handleTestStep1 = async () => {
    setTestState1('testing');
    setTestMessage1('Pinging connection endpoint...');

    if (mode === 'local') {
      // Test Fastify backend connection
      try {
        const detected = await detectAppMode();
        if (detected === 'local') {
          setTestState1('success');
          setTestMessage1('Backend server active and responsive (Local CLI initialized).');
          // Save settings
          saveSettings({ localClaudeToken: claudeToken });
        } else {
          setTestState1('error');
          setTestMessage1('Could not reach backend on http://localhost:8787.');
        }
      } catch (err) {
        setTestState1('error');
        setTestMessage1('Backend server check failed.');
      }
    } else {
      // Test Anthropic key directly from browser
      if (!anthropicKey) {
        setTestState1('error');
        setTestMessage1('Please enter your Anthropic API Key.');
        return;
      }
      try {
        // Direct browser access is flagged so we can verify the key
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: MODEL_CONFIG.claudeModel,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'Ping' }],
          }),
        });

        if (response.ok || response.status === 400) {
          // A 400 is acceptable here as it means our authentication went through but message parameters might be empty/short
          setTestState1('success');
          setTestMessage1('Anthropic key verified successfully!');
          saveSettings({ anthropicApiKey: anthropicKey });
        } else {
          const errData = await response.json().catch(() => ({}));
          setTestState1('error');
          setTestMessage1(errData?.error?.message || `Authentication failed (Status ${response.status})`);
        }
      } catch (err) {
        setTestState1('error');
        setTestMessage1('Network error connecting to Anthropic API. Check CORS/connection.');
      }
    }
  };

  const handleTestStep2 = async () => {
    setTestState2('testing');
    setTestMessage2('Verifying Google API key with Gemini...');

    if (!geminiKey) {
      setTestState2('error');
      setTestMessage2('Please enter your Google API Key.');
      return;
    }

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_CONFIG.geminiModel}:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Ping' }] }],
          }),
        }
      );

      if (response.ok) {
        setTestState2('success');
        setTestMessage2('Google/Gemini API key verified successfully!');
        saveSettings({ geminiApiKey: geminiKey });
      } else {
        const errData = await response.json().catch(() => ({}));
        setTestState2('error');
        setTestMessage2(errData?.error?.message || `Failed validation (Status ${response.status})`);
      }
    } catch (err) {
      setTestState2('error');
      setTestMessage2('Network error connecting to Google API.');
    }
  };

  const handleCompleteSetup = () => {
    // Save final keys
    saveSettings({
      anthropicApiKey: anthropicKey,
      geminiApiKey: geminiKey,
      localClaudeToken: claudeToken,
    });
    onSetupComplete();
  };

  const isStep1Complete = mode === 'local' ? true : !!anthropicKey;
  const isStep2Complete = !!geminiKey;

  return (
    <div className="max-w-md mx-auto my-12 px-4 sm:px-6">
      
      {/* Title */}
      <div className="text-center mb-8">
        <span className="text-xs font-semibold tracking-wider text-cyan-400 uppercase font-sans">
          Welcome to GovPrep
        </span>
        <h2 className="text-3xl font-extrabold tracking-tight text-white font-display mt-2">
          Setup Study Companion
        </h2>
        <p className="text-sm text-slate-400 mt-2">
          Configure connection keys to unlock summaries, FSRS active recall, and full exam prep.
        </p>
      </div>

      {/* Stepper Headers */}
      <div className="flex justify-between items-center mb-8 bg-slate-900/40 p-1.5 border border-white/5 rounded-xl">
        <button
          onClick={() => setStep(1)}
          className={`flex-1 text-center py-2 text-xs font-semibold rounded-lg transition-all duration-200 ${
            step === 1
              ? 'bg-slate-800 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          1. Study Brain
        </button>
        <button
          onClick={() => setStep(2)}
          className={`flex-1 text-center py-2 text-xs font-semibold rounded-lg transition-all duration-200 ${
            step === 2
              ? 'bg-slate-800 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          2. YouTube & Ingest
        </button>
      </div>

      {/* Step 1: Brain Config */}
      {step === 1 && (
        <div className="space-y-6">
          <div className="glass-panel p-6 space-y-4">
            <h3 className="text-lg font-bold text-white font-display flex items-center gap-2">
              <span>🧠</span> Configure AI Brain
            </h3>

            {mode === 'local' ? (
              // Local mode config
              <div className="space-y-4">
                <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                  <div className="flex gap-2">
                    <span className="text-lg">💻</span>
                    <div>
                      <p className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Local Backend Active</p>
                      <p className="text-xs text-slate-300 mt-1">
                        GovPrep will route requests to Claude using your command line subscription. No Anthropic API keys are required.
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
              // Hosted mode config
              <div className="space-y-4">
                <div className="p-3.5 bg-cyan-500/10 border border-cyan-500/20 rounded-xl">
                  <div className="flex gap-2">
                    <span className="text-lg">🌐</span>
                    <div>
                      <p className="text-xs font-bold text-cyan-400 uppercase tracking-wider">Hosted Mode (Browser Only)</p>
                      <p className="text-xs text-slate-300 mt-1">
                        Provide your own Anthropic API key. Requests go direct to Anthropic with local settings storage.
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
                    Stored on-device in `localStorage`. Sent securely with browser-direct headers.
                  </p>
                </div>
              </div>
            )}

            {/* Test Connection feedback */}
            {testState1 !== 'idle' && (
              <div className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                testState1 === 'testing' ? 'bg-slate-800/40 border-slate-700 text-slate-300' :
                testState1 === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                'bg-rose-500/10 border-rose-500/20 text-rose-400'
              }`}>
                {testState1 === 'testing' && <span className="animate-spin inline-block w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full" />}
                {testState1 === 'success' && <span>✅</span>}
                {testState1 === 'error' && <span>❌</span>}
                <p className="leading-tight">{testMessage1}</p>
              </div>
            )}

            <button
              onClick={handleTestStep1}
              disabled={testState1 === 'testing'}
              className="w-full btn-secondary text-sm"
            >
              Test Connection
            </button>
          </div>

          <div className="flex justify-end">
            <button
              onClick={() => setStep(2)}
              disabled={!isStep1Complete}
              className="btn-primary text-sm flex items-center gap-1.5"
            >
              Next Step
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Google/Gemini API Config */}
      {step === 2 && (
        <div className="space-y-6">
          <div className="glass-panel p-6 space-y-4">
            <h3 className="text-lg font-bold text-white font-display flex items-center gap-2">
              <span>📹</span> YouTube Search & Ingest
            </h3>

            <div className="space-y-4">
              <div className="p-3.5 bg-indigo-500/10 border border-indigo-500/20 rounded-xl">
                <p className="text-xs font-bold text-indigo-400 uppercase tracking-wider">Google AI Developer Key</p>
                <p className="text-xs text-slate-300 mt-1">
                  Required to search video whitelists. In hosted mode, it also unlocks Gemini-by-URL to process YouTube visuals.
                </p>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Google API Key
                </label>
                <input
                  type="password"
                  placeholder="AIzaSy..."
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700/50 rounded-xl px-4 py-2.5 text-slate-200 focus:outline-none focus:border-cyan-500 transition-colors"
                />
                <p className="text-[10px] text-slate-500">
                  Setup recommendation: Lock this key in Google Cloud Console to your local/pages referrer url.
                </p>
              </div>
            </div>

            {/* Test Connection feedback */}
            {testState2 !== 'idle' && (
              <div className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                testState2 === 'testing' ? 'bg-slate-800/40 border-slate-700 text-slate-300' :
                testState2 === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                'bg-rose-500/10 border-rose-500/20 text-rose-400'
              }`}>
                {testState2 === 'testing' && <span className="animate-spin inline-block w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full" />}
                {testState2 === 'success' && <span>✅</span>}
                {testState2 === 'error' && <span>❌</span>}
                <p className="leading-tight">{testMessage2}</p>
              </div>
            )}

            <button
              onClick={handleTestStep2}
              disabled={testState2 === 'testing'}
              className="w-full btn-secondary text-sm"
            >
              Test Connection
            </button>
          </div>

          <div className="flex justify-between">
            <button
              onClick={() => setStep(1)}
              className="btn-secondary text-sm flex items-center gap-1.5"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>

            <button
              onClick={handleCompleteSetup}
              disabled={!isStep2Complete}
              className="btn-success text-sm flex items-center gap-1.5 shadow-neon-green/10"
            >
              Launch Companion
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </button>
          </div>
        </div>
      )}

    </div>
  );
};
