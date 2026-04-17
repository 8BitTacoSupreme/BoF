/**
 * DeploymentStatusPanel.jsx
 *
 * Displays deployment status after the user clicks Push Live. Shows:
 *   - Job state pill (Submitting → Compiling → Starting → Running → Streaming / Failed / Stopped)
 *   - Output topic name and elapsed time
 *   - Live Messages Table (when Running or Streaming) — polls every 2s
 *   - Error area (three error classes per D-313)
 *   - Action row: Stop with inline confirmation, Retry, Edit SQL
 *
 * Props:
 *   jobId       {string}    Job ID from POST /api/query/deploy response
 *   outputTopic {string}    Output topic name
 *   onClose     {function}  Called when user dismisses the panel
 *   onStopped   {function}  Called after job is successfully stopped
 *   onRetry     {function}  Called when user clicks Retry after failure
 *   onEditSql   {function}  Called when user clicks Edit SQL after submission error
 */

import { useState } from 'react';
import { useJobPolling } from '../hooks/useJobPolling';
import { useMessagePolling } from '../hooks/useMessagePolling';

// ─────────────────────────────────────────────────────────────────────────────
// State pill styles (per 03-UI-SPEC.md Component Inventory item 3)
// ─────────────────────────────────────────────────────────────────────────────

const STATE_STYLES = {
  Submitting: { bg: 'bg-gray-700', text: 'text-gray-300', dot: 'bg-gray-400 animate-pulse' },
  Compiling:  { bg: 'bg-yellow-900/30', text: 'text-yellow-300', dot: 'bg-yellow-400 animate-pulse' },
  Starting:   { bg: 'bg-yellow-900/30', text: 'text-yellow-300', dot: 'bg-yellow-400 animate-pulse' },
  Running:    { bg: 'bg-green-900/30', text: 'text-green-300', dot: 'bg-green-500' },
  Streaming:  { bg: 'bg-cyan-900/30', text: 'text-cyan-300', dot: 'bg-cyan-400' },
  Failed:     { bg: 'bg-red-900/20', text: 'text-red-400', dot: null },
  Stopped:    { bg: 'bg-gray-700', text: 'text-gray-400', dot: null },
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatElapsed(ms) {
  if (!ms || ms <= 0) return '0s';
  return `${Math.floor(ms / 1000)}s`;
}

/**
 * Parse message value (JSON string) into a flat key-value object.
 * Falls back to { value: rawString } on parse failure.
 */
function parseMessageValue(raw) {
  if (typeof raw !== 'string') return raw || {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) return parsed;
    return { value: raw };
  } catch {
    return { value: raw };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Live Messages Table sub-component
// ─────────────────────────────────────────────────────────────────────────────

function LiveMessagesTable({ topicName, enabled, onRefreshJob }) {
  const { messages, isLoading, noMessagesTimeout } = useMessagePolling(topicName, enabled);

  if (noMessagesTimeout) {
    return (
      <div className="py-4 px-3 text-center">
        <p className="text-sm font-semibold text-gray-400">No messages yet</p>
        <p className="text-xs text-gray-500 mt-1">
          Job is running but no matching source events have arrived.{' '}
          <button
            onClick={onRefreshJob}
            className="text-xs text-cyan-400 hover:text-cyan-200 underline"
          >
            Check Job Status
          </button>
        </p>
      </div>
    );
  }

  if (isLoading && messages.length === 0) {
    // Loading skeleton — 3 pulse rows
    return (
      <div className="bg-gray-900/50 rounded border border-gray-700/50 p-2 flex flex-col gap-1.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-gray-700/40 animate-pulse h-6 rounded" />
        ))}
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="py-3 px-3 text-center">
        <p className="text-xs text-gray-500">Waiting for messages...</p>
      </div>
    );
  }

  // Derive columns from first message value
  const firstParsed = parseMessageValue(messages[0]?.value);
  const valueColumns = Object.keys(firstParsed);

  return (
    <div className="bg-gray-900/50 rounded border border-gray-700/50 overflow-auto max-h-60">
      <table className="w-full text-sm">
        <thead>
          <tr>
            {valueColumns.map((col) => (
              <th
                key={col}
                className="text-xs text-gray-500 font-mono px-3 py-1.5 text-left border-b border-gray-700 bg-gray-800 sticky top-0"
              >
                {col}
              </th>
            ))}
            <th className="text-xs text-gray-500 font-mono px-3 py-1.5 text-left border-b border-gray-700 bg-gray-800 sticky top-0">
              offset
            </th>
          </tr>
        </thead>
        <tbody>
          {messages.map((msg, idx) => {
            const parsed = parseMessageValue(msg?.value);
            return (
              <tr key={`${msg?.offset ?? idx}-${idx}`} className="hover:bg-gray-800/50">
                {valueColumns.map((col) => (
                  <td
                    key={col}
                    className="text-xs text-gray-300 font-mono px-3 py-1.5 border-b border-gray-700/30 max-w-xs truncate"
                    title={String(parsed[col] ?? '')}
                  >
                    {String(parsed[col] ?? '')}
                  </td>
                ))}
                <td className="text-xs text-gray-600 font-mono px-3 py-1.5 border-b border-gray-700/30">
                  {msg?.offset ?? '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DeploymentStatusPanel (main export)
// ─────────────────────────────────────────────────────────────────────────────

export default function DeploymentStatusPanel({
  jobId,
  outputTopic,
  onClose,
  onStopped,
  onRetry,
  onEditSql,
}) {
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [isStopping, setIsStopping] = useState(false);

  const { jobState, error, elapsed, refresh } = useJobPolling(jobId, !!jobId);

  const displayState = jobState || 'Submitting';
  const stateStyle = STATE_STYLES[displayState] || STATE_STYLES.Submitting;

  const isRunningOrStreaming = displayState === 'Running' || displayState === 'Streaming';
  const isFailed = displayState === 'Failed';

  // Classify error type for distinct error UI (D-313)
  const isConnectivityError = error && (error.includes('unreachable') || error.includes('Gateway'));
  const isSubmissionError =
    isFailed &&
    error &&
    !isConnectivityError &&
    (error.toLowerCase().includes('parse') ||
      error.toLowerCase().includes('compile') ||
      error.toLowerCase().includes('syntax') ||
      error.toLowerCase().includes('sql'));
  const isRuntimeError = isFailed && error && !isConnectivityError && !isSubmissionError;

  // Stop handler
  const handleConfirmStop = async () => {
    setIsStopping(true);
    try {
      await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
      setShowStopConfirm(false);
      if (onStopped) onStopped();
    } catch {
      // Ignore stop errors — polling will reflect terminal state
    } finally {
      setIsStopping(false);
    }
  };

  return (
    <div className="bg-gray-800 rounded-md border border-gray-700 p-4 flex flex-col gap-3">
      {/* ── Header row with close button ── */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-300">Deployment Status</span>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-200 text-lg leading-none px-1"
          aria-label="Dismiss deployment status"
        >
          ×
        </button>
      </div>

      {/* ── Status row ── */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Job state pill */}
        <span
          className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium ${stateStyle.bg} ${stateStyle.text}`}
        >
          {stateStyle.dot && (
            <span
              className={`w-2 h-2 rounded-full inline-block ${stateStyle.dot}`}
              aria-hidden="true"
            />
          )}
          {displayState}
        </span>

        {/* Output topic */}
        {outputTopic && (
          <span className="font-mono text-xs text-gray-400 truncate max-w-xs" title={outputTopic}>
            {outputTopic}
          </span>
        )}

        {/* Elapsed time */}
        {elapsed > 0 && (
          <span className="text-xs text-gray-500">{formatElapsed(elapsed)}</span>
        )}
      </div>

      {/* ── Live Messages (Running or Streaming only) ── */}
      {isRunningOrStreaming && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Live Messages
          </h3>
          <LiveMessagesTable
            topicName={outputTopic}
            enabled={isRunningOrStreaming}
            onRefreshJob={refresh}
          />
        </div>
      )}

      {/* ── Error area (conditional, three error classes per D-313) ── */}

      {/* Connectivity error */}
      {isConnectivityError && (
        <p className="text-xs text-yellow-400">{error}</p>
      )}

      {/* Submission error — SQL Gateway 400 / compile/parse failure */}
      {isSubmissionError && (
        <div className="border border-red-700 bg-red-900/20 rounded-md p-3">
          <p className="text-sm font-semibold text-red-400">SQL rejected by Flink</p>
          <p className="text-xs text-red-300 mt-1">
            {error} — Edit SQL to fix and push again.
          </p>
          <button
            onClick={onEditSql}
            className="text-xs text-red-400 hover:text-red-200 underline mt-2 block"
          >
            Edit SQL
          </button>
        </div>
      )}

      {/* Runtime error — job transitioned to Failed */}
      {isRuntimeError && (
        <div className="border border-red-700 bg-red-900/20 rounded-md p-3">
          <p className="text-sm font-semibold text-red-400">Job failed</p>
          <p className="text-xs text-red-300 mt-1">
            {error.slice(0, 200)} — Retry to submit again.
          </p>
          <button
            onClick={onRetry}
            className="text-xs text-red-400 hover:text-red-200 underline mt-2 block"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Action row ── */}
      {isRunningOrStreaming && (
        <div className="flex items-center gap-2 pt-1">
          {showStopConfirm ? (
            <>
              <span className="text-sm text-gray-300">Stop this job?</span>
              <button
                onClick={handleConfirmStop}
                disabled={isStopping}
                className="text-sm text-red-400 hover:text-red-200 underline ml-2 disabled:opacity-50"
              >
                {isStopping ? 'Stopping...' : 'Yes, stop'}
              </button>
              <button
                onClick={() => setShowStopConfirm(false)}
                className="text-sm text-gray-500 hover:text-gray-300 underline ml-2"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setShowStopConfirm(true)}
              className="text-sm text-red-400 hover:text-red-200 border border-red-700/50 rounded px-3 py-1"
            >
              Stop
            </button>
          )}
        </div>
      )}
    </div>
  );
}
