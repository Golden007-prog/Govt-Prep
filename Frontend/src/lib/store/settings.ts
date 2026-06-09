import { MODELS } from '../config/models';

export interface AppSettings {
  anthropicApiKey: string;
  geminiApiKey: string;
  localClaudeToken: string;
  activeMode: 'local' | 'hosted';
  // Study progress metrics
  xp: number;
  streak: number;
  lastActiveDate: string; // YYYY-MM-DD
}

const DEFAULT_SETTINGS: AppSettings = {
  anthropicApiKey: '',
  geminiApiKey: '',
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
    return { ...DEFAULT_SETTINGS, ...parsed };
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
  geminiModel: MODELS.video,
};

// Check if setup is complete based on active mode
export function isSetupComplete(mode: 'local' | 'hosted', settings: AppSettings): boolean {
  if (mode === 'local') {
    // Local mode just needs the google key for search (and optionally local Claude subscription configured on backend)
    return !!settings.geminiApiKey;
  } else {
    // Hosted mode needs both Anthropic brain key and Gemini video key
    return !!settings.anthropicApiKey && !!settings.geminiApiKey;
  }
}
