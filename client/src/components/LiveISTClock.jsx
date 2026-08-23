import { useEffect, useState } from 'react';

import api from '../api/client';
import { serverNowMs, setServerTime } from '../utils/serverClock';

const IST_FORMAT = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
});

/** Visible, server-synchronised IST clock. */
export default function LiveISTClock({ className = '' }) {
  const [, rerender] = useState(0);

  useEffect(() => {
    let mounted = true;
    const sync = async () => {
      try {
        const response = await api.get('/health');
        setServerTime(response.data?.time);
        if (mounted) rerender((n) => n + 1);
      } catch {
        // Existing server anchor remains usable if a periodic refresh fails.
      }
    };
    sync();
    const tick = window.setInterval(() => mounted && rerender((n) => n + 1), 1000);
    const refresh = window.setInterval(sync, 60_000);
    return () => {
      mounted = false;
      window.clearInterval(tick);
      window.clearInterval(refresh);
    };
  }, []);

  return <span className={className}>IST: {IST_FORMAT.format(new Date(serverNowMs()))}</span>;
}
