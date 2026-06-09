import { ENV } from '../config/env';

export type AppMode = 'local' | 'hosted';

export async function detectAppMode(): Promise<AppMode> {
  try {
    const response = await fetch(`${ENV.localBackendUrl}/health`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data && data.mode === 'local') {
        return 'local';
      }
    }
    return 'hosted';
  } catch (error) {
    // If the network call fails (e.g. server not running), default to hosted
    console.log('Backend not reachable, defaulting to Hosted mode:', error);
    return 'hosted';
  }
}
