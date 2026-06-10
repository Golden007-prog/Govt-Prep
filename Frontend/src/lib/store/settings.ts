import { ENV } from '../config/env';
import { MODELS } from '../config/models';

export interface AppSettings {
  anthropicApiKey: string;
  localClaudeToken: string;
  activeMode: 'local' | 'hosted';
  // Study progress metrics
  xp: number;
  streak: number;
  lastActiveDate: string; // YYYY-MM-DD
}

const DEFAULT_SETTINGS: AppSettings = {
  // Dev-only convenience seed from .env.local; empty in production builds (see env.ts).
  anthropicApiKey: ENV.anthropicApiKeyDefault,
  localClaudeToken: '',
  activeMode: 'hosted',
  xp: 0,
  streak: 0,
  lastActiveDate: '',
};

export function getSettings(): AppSettings {
  try {
    const saved = localStorage.getItem('govprep_settings');
    if (!saved) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(saved);
    const merged = { ...DEFAULT_SETTINGS, ...parsed };
    // Migration: drop the removed Gemini key field if present from older versions.
    delete (merged as Record<string, unknown>).geminiApiKey;
    return merged;
  } catch (e) {
    console.error('Error loading settings from localStorage', e);
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Partial<AppSettings>): void {
  try {
    const current = getSettings();
    const updated = { ...current, ...settings };
    localStorage.setItem('govprep_settings', JSON.stringify(updated));
  } catch (e) {
    console.error('Error saving settings to localStorage', e);
  }
}

export function clearSettings(): void {
  localStorage.removeItem('govprep_settings');
}

// Model ids come from the single env-driven config module (no hardcoded ids — spec §10).
// Kept as MODEL_CONFIG for the BYOK connection-test in SetupScreen.
export const MODEL_CONFIG = {
  claudeModel: MODELS.grading,
};

// Claude-only architecture: setup needs an Anthropic key in hosted mode; local mode
// talks to the backend (subscription/CLI or backend-held key) so nothing is required.
export function isSetupComplete(mode: 'local' | 'hosted', settings: AppSettings): boolean {
  if (mode === 'local') {
    return true;
  }
  return !!settings.anthropicApiKey;
}
