import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@clerk/clerk-react';

export default function useProgress(projectId) {
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [message, setMessage] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState(null);
  const eventSourceRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const cancelledRef = useRef(false);
  const { getToken } = useAuth();

  // Stable connect function that always gets a fresh token
  const connect = useCallback(async () => {
    // Close any existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    if (cancelledRef.current || !projectId) return;

    try {
      // Always get a fresh token on each connection attempt
      const token = await getToken();
      if (cancelledRef.current) return;

      const url = token
        ? `/api/processing/progress/${projectId}?token=${encodeURIComponent(token)}`
        : `/api/processing/progress/${projectId}`;

      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => {
        if (!cancelledRef.current) {
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
        if (cancelledRef.current) return;

        // Close the broken connection — do NOT let the browser auto-reconnect
        // with the stale (expired JWT) URL.
        es.close();
        eventSourceRef.current = null;
        setIsConnected(false);
        setError('Connection lost. Reconnecting...');

        // Reconnect after a short delay with a fresh token
        if (!reconnectTimerRef.current) {
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            connect();
          }, 3000);
        }
      };
    } catch {
      if (!cancelledRef.current) {
        setError('Failed to connect to progress stream');
        // Retry after delay
        if (!reconnectTimerRef.current) {
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            connect();
          }, 5000);
        }
      }
    }
  }, [projectId, getToken]);

  useEffect(() => {
    cancelledRef.current = false;
    connect();

    return () => {
      cancelledRef.current = true;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      setIsConnected(false);
    };
  }, [connect]);

  return { progress, stage, message, isConnected, error };
}
