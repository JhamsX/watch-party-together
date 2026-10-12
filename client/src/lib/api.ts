const configuredServerUrl = (import.meta.env.VITE_SERVER_URL || '').trim().replace(/\/+$/, '');

// In local development, Vite proxies /api and /socket.io to the Node server.
// In production, set VITE_SERVER_URL only when the API is hosted on another origin.
export const SERVER_URL = configuredServerUrl;
export const API_URL = `${SERVER_URL}/api`;

function healthCheckUrl() {
  const origin = SERVER_URL || window.location.origin;
  return `${origin}/api/health`;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = sessionStorage.getItem('together_auth_token');
  const headers = new Headers(options.headers);
  if (options.body) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...options, headers });
  } catch {
    throw new Error(
      `Cannot reach the Watch Party backend. Check that the Node.js server is running, then open ${healthCheckUrl()}. ` +
      `If that health check does not load, run "npm run dev" from the project root and check the server terminal for startup errors. ` +
      `If it returns a database error, start MySQL and run "npm run db:deploy".`
    );
  }

  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data as T;
}

export function socketOrigin() {
  return SERVER_URL || window.location.origin;
}
