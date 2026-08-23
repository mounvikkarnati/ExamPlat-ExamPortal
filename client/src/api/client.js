import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5030/api';

const api = axios.create({ baseURL: BASE_URL, timeout: 30000 });

// Attach the JWT on every request.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('examplat_token');
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
      localStorage.removeItem('examplat_token');
      localStorage.removeItem('examplat_meta');
      if (!window.location.pathname.startsWith('/login')) {
        window.location.replace('/login');
      }
    }
    return Promise.reject(error);
  }
);

export default api;