import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@clerk/clerk-react';

export default function useProgress(projectId) {
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [message, setMessage] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState(null);
  const eventSourceRef = useRef(null);
  const { getToken } = useAuth();

  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;

    async function connect() {
      try {
        const token = await getToken();
        if (cancelled) return;

        const url = token
          ? `/api/processing/progress/${projectId}?token=${encodeURIComponent(token)}`
          : `/api/processing/progress/${projectId}`;

        const es = new EventSource(url);
        eventSourceRef.current = es;

        es.onopen = () => {
          if (!cancelled) {
            setIsConnected(true);
            setError(null);
          }
        };

        es.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.progress !== undefined) setProgress(data.progress);
            if (data.stage !== undefined) setStage(data.stage);
            if (data.message !== undefined) setMessage(data.message);
          } catch {
            // Non-JSON message; ignore
          }
        };

        es.onerror = () => {
          if (!cancelled) {
            setIsConnected(false);
            setError('Connection lost. Retrying...');
          }
        };
      } catch {
        if (!cancelled) {
          setError('Failed to connect to progress stream');
        }
      }
    }

    connect();

    return () => {
      cancelled = true;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setIsConnected(false);
    };
  }, [projectId, getToken]);

  return { progress, stage, message, isConnected, error };
}
