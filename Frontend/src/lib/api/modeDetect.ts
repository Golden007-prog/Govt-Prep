import { ENV } from '../config/env';

export type AppMode = 'local' | 'hosted';

export async function detectAppMode(): Promise<AppMode> {
  try {
    // Time-bounded: this probe gates first paint, and a half-open port 8787 must not hang the app.
    const response = await fetch(`${ENV.localBackendUrl}/health`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(3000),
    });

    if (response.ok) {
      const data = await response.json();
      if (data && data.mode === 'local') {
        return 'local';
      }
    }
    return 'hosted';
  } catch (error) {
    // Not reachable, hung, or timed out — default to hosted
    console.log('Backend not reachable, defaulting to Hosted mode:', error);
    return 'hosted';
  }
}
