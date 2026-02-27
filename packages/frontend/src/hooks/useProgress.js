import { useState, useEffect, useRef } from 'react';

export default function useProgress(projectId) {
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState(null);
  const eventSourceRef = useRef(null);

  useEffect(() => {
    if (!projectId) return;

    const url = `/api/processing/progress/${projectId}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      setIsConnected(true);
      setError(null);
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.progress !== undefined) setProgress(data.progress);
        if (data.stage !== undefined) setStage(data.stage);
      } catch {
        // Non-JSON message; ignore
      }
    };

    es.onerror = () => {
      setIsConnected(false);
      setError('Connection lost. Retrying...');
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
      setIsConnected(false);
    };
  }, [projectId]);

  return { progress, stage, isConnected, error };
}
