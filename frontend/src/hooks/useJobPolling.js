import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * useJobPolling(jobId, enabled)
 *
 * Polls GET /api/jobs/:jobId every 5s while enabled is true.
 * Stops polling when job reaches a terminal state (Failed, Stopped)
 * or when enabled becomes false (panel closed, user navigated away).
 *
 * Returns: { jobState, error, elapsed, flinkJobId, outputTopic, refresh }
 */
export function useJobPolling(jobId, enabled = true) {
  const [jobState, setJobState] = useState(null);
  const [error, setError] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [flinkJobId, setFlinkJobId] = useState(null);
  const [outputTopic, setOutputTopic] = useState(null);
  const intervalRef = useRef(null);

  const fetchStatus = useCallback(async () => {
    if (!jobId) return;
    try {
      const res = await fetch(`/api/jobs/${jobId}`);
      if (!res.ok) {
        const err = await res.json();
        setError(err.error || 'Failed to fetch job status');
        return;
      }
      const data = await res.json();
      setJobState(data.state);
      setError(data.error || null);
      setElapsed(data.elapsed || 0);
      setFlinkJobId(data.flinkJobId || null);
      setOutputTopic(data.outputTopic || null);
    } catch {
      setError(`Gateway unreachable — check Docker Compose. Retrying in 5s...`);
    }
  }, [jobId]);

  useEffect(() => {
    if (!jobId || !enabled) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    // Fetch immediately, then every 5s
    fetchStatus();
    intervalRef.current = setInterval(fetchStatus, 5000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [jobId, enabled, fetchStatus]);

  // Stop polling on terminal states
  useEffect(() => {
    if (jobState === 'Failed' || jobState === 'Stopped') {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
  }, [jobState]);

  return { jobState, error, elapsed, flinkJobId, outputTopic, refresh: fetchStatus };
}
