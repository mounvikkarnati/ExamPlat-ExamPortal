import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5030/api';

const api = axios.create({ baseURL: BASE_URL, timeout: 30000 });

// Storage helpers with try/catch: a locked-down browser (e.g. the PyQt5 exam
// shell) can disable localStorage, and in Chromium such access THROWS instead
// of returning null. Without the guards below, an interceptor throw here would
// silently cancel the login POST before it ever reaches the server.
function readItem(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function removeItem(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* noop */
  }
}

// Attach the JWT on every request.
api.interceptors.request.use((config) => {
  const token = readItem('examplat_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On 401 (except during the login call itself) -> clear session and send user back.
api.interceptors.response.use(
  (resp) => resp,
  (error) => {
    const status = error.response?.status;
    const url = String(error.config?.url || '');
    if (status === 401 && url !== '/exam/login') {
      removeItem('examplat_token');
      removeItem('examplat_meta');
      if (!window.location.pathname.startsWith('/login')) {
        window.location.replace('/login');
      }
    }
    return Promise.reject(error);
  }
);

export default api;