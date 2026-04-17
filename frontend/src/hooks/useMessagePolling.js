import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * useMessagePolling(topicName, enabled)
 *
 * Polls GET /api/topics/:topic/messages every 2s while enabled is true.
 * Tracks nextOffset to only fetch new messages on each poll.
 * Accumulates messages (newest first) up to 100 max.
 *
 * Returns: { messages, isLoading, noMessagesTimeout }
 *
 * noMessagesTimeout: true if no messages have arrived after 30s of polling (D-311)
 */
export function useMessagePolling(topicName, enabled = true) {
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [noMessagesTimeout, setNoMessagesTimeout] = useState(false);
  const nextOffsetRef = useRef(null);
  const intervalRef = useRef(null);
  const startTimeRef = useRef(null);
  const hasReceivedRef = useRef(false);

  const fetchMessages = useCallback(async () => {
    if (!topicName) return;

    const params = new URLSearchParams({ limit: '10' });
    if (nextOffsetRef.current !== null) {
      params.set('since', String(nextOffsetRef.current));
    }

    try {
      const res = await fetch(`/api/topics/${encodeURIComponent(topicName)}/messages?${params}`);
      if (!res.ok) return;

      const data = await res.json();
      if (data.messages && data.messages.length > 0) {
        hasReceivedRef.current = true;
        setIsLoading(false);
        setNoMessagesTimeout(false);
        setMessages((prev) => {
          // Prepend new messages (newest first), cap at 100
          const combined = [...data.messages.reverse(), ...prev];
          return combined.slice(0, 100);
        });
      }
      if (data.nextOffset != null) {
        nextOffsetRef.current = data.nextOffset;
      }
    } catch {
      // Silently retry on next interval
    }

    // Check 30s timeout for no-messages state (D-311)
    if (!hasReceivedRef.current && startTimeRef.current) {
      if (Date.now() - startTimeRef.current > 30000) {
        setNoMessagesTimeout(true);
        setIsLoading(false);
      }
    }
  }, [topicName]);

  useEffect(() => {
    if (!topicName || !enabled) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    // Reset state on new topic
    setMessages([]);
    setIsLoading(true);
    setNoMessagesTimeout(false);
    nextOffsetRef.current = null;
    hasReceivedRef.current = false;
    startTimeRef.current = Date.now();

    // Fetch immediately, then every 2s
    fetchMessages();
    intervalRef.current = setInterval(fetchMessages, 2000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [topicName, enabled, fetchMessages]);

  return { messages, isLoading, noMessagesTimeout };
}
