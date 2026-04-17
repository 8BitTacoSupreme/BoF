/**
 * QueryBuilder.jsx
 *
 * Main Phase 2/3 component — NLP input → SQL generation → validation → sample output → Push Live.
 *
 * Layout:
 *   +---------------------------+---------------------------------------+
 *   | Schema Sidebar            | Main Panel                            |
 *   | (collapsible)             |                                       |
 *   |  > retail.orders          | [NLP textarea + example prompts]      |
 *   |    - order_id (BIGINT)    | [SqlEditor with Monaco]               |
 *   |    ...                    | [Push Live button row]                |
 *   |  > retail.returns         | [DeploymentStatusPanel]               |
 *   |    ...                    | [SampleOutput table/JSON]             |
 *   |  > derived.returns ◆      | [Error display]                      |
 *   |    ...                    | [Recent history]                      |
 *   +---------------------------+---------------------------------------+
 *
 * Props:
 *   onNavigateToTopics {function} Optional — navigate back to topic browser
 */

import { useState, useEffect, useCallback } from 'react';
import SqlEditor from './SqlEditor';
import SampleOutput from './SampleOutput';
import DeploymentStatusPanel from './DeploymentStatusPanel';
import { useJobPolling } from '../hooks/useJobPolling';

const HISTORY_KEY = 'bof-query-history';
const MAX_HISTORY = 10;

const EXAMPLE_PROMPTS = [
  'customer return rates by product for the last 3 weeks',
  'total sales by product per day',
  'cancelled orders from the last hour',
  'orders with their return reasons',
];

// ─────────────────────────────────────────────────────────────────────────────
// Schema Sidebar
// ─────────────────────────────────────────────────────────────────────────────

function SchemaSidebar({ schemas, isOpen, onToggle }) {
  const [expandedTopics, setExpandedTopics] = useState({});

  const toggleTopic = (topic) => {
    setExpandedTopics((prev) => ({ ...prev, [topic]: !prev[topic] }));
  };

  return (
    <div className={`flex-shrink-0 transition-all duration-200 ${isOpen ? 'w-64' : 'w-10'}`}>
      {/* Toggle button */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 bg-gray-800 border-b border-gray-700 text-gray-400 hover:text-gray-200 text-xs font-medium"
        aria-label={isOpen ? 'Collapse schema sidebar' : 'Expand schema sidebar'}
      >
        {isOpen ? (
          <>
            <span>Schema</span>
            <span aria-hidden="true">&#8249;</span>
          </>
        ) : (
          <span aria-hidden="true" className="mx-auto">&#8250;</span>
        )}
      </button>

      {isOpen && (
        <div className="overflow-y-auto bg-gray-800 border-r border-gray-700 h-full">
          {schemas.length === 0 ? (
            <p className="p-3 text-xs text-gray-500">Loading schemas...</p>
          ) : (
            <ul className="py-1">
              {schemas.map(({ topic, fields, isDerived }) => (
                <li key={topic} className="border-b border-gray-700/50">
                  <button
                    onClick={() => toggleTopic(topic)}
                    className="w-full flex items-center justify-between px-3 py-2 text-left text-xs text-cyan-400 font-mono hover:bg-gray-700 transition-colors"
                    aria-label={isDerived ? `${topic} (derived)` : topic}
                  >
                    <span className="truncate flex items-center gap-1">
                      {topic}
                      {isDerived && (
                        <span className="text-xs text-cyan-300 bg-cyan-900/20 rounded px-1.5 py-0.5 font-mono ml-1">
                          ◆ derived
                        </span>
                      )}
                    </span>
                    <span className="ml-1 text-gray-500" aria-hidden="true">
                      {expandedTopics[topic] ? '▾' : '▸'}
                    </span>
                  </button>

                  {expandedTopics[topic] && (
                    <ul className="pb-1 bg-gray-900/30">
                      {fields.map(({ name, type }) => (
                        <li
                          key={name}
                          className="px-4 py-0.5 flex items-center justify-between text-xs"
                        >
                          <span className="text-gray-300 font-mono">{name}</span>
                          <span className="text-purple-400 font-mono text-xs ml-2">{type}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// QueryBuilder (main component)
// ─────────────────────────────────────────────────────────────────────────────

export default function QueryBuilder({ onNavigateToTopics }) {
  // State
  const [query, setQuery] = useState('');
  const [sessionId] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    } catch {
      return [];
    }
  });
  const [schemas, setSchemas] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [editedSql, setEditedSql] = useState(null);

  // Deployment state (Phase 3 — Push Live)
  const [deployment, setDeployment] = useState(null); // { jobId, outputTopic } | null
  const [isDeploying, setIsDeploying] = useState(false);

  // Poll job state at QueryBuilder level so we can gate the button
  const { jobState: deploymentState } = useJobPolling(
    deployment?.jobId,
    !!deployment
  );

  // ── Schema fetch / refresh ────────────────────────────────────────────────

  const refreshSchemas = useCallback(() => {
    fetch('/api/schemas')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setSchemas(data);
      })
      .catch(() => {
        // Schema sidebar is non-critical; silently fail
      });
  }, []);

  // Fetch schemas on mount
  useEffect(() => {
    refreshSchemas();
  }, [refreshSchemas]);

  // Auto-refresh schemas when job reaches Running (D-309)
  // Delay 3s to give Flink time to register the output schema
  useEffect(() => {
    if (deploymentState === 'Running') {
      const timer = setTimeout(refreshSchemas, 3000);
      return () => clearTimeout(timer);
    }
  }, [deploymentState, refreshSchemas]);

  // Current SQL to display (edited overrides generated)
  const displaySql = editedSql !== null ? editedSql : result?.sql || '';
  const validationStatus = result?.validation?.status || null;

  // ── Push Live enabled logic ───────────────────────────────────────────────

  const pushLiveEnabled =
    !isDeploying &&
    (validationStatus === 'green' || validationStatus === 'yellow') &&
    (!deployment || deploymentState === 'Failed' || deploymentState === 'Stopped');

  const jobIsActive =
    deployment &&
    deploymentState &&
    deploymentState !== 'Failed' &&
    deploymentState !== 'Stopped';

  // ── Submit handler ────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    if (!query.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const endpoint = result ? '/api/query/refine' : '/api/query';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), sessionId }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Query failed');
      }

      const data = await response.json();
      setResult(data);
      setEditedSql(null);

      // Persist to history
      const newHistory = [{ query: query.trim(), timestamp: Date.now() }, ...history].slice(
        0,
        MAX_HISTORY
      );
      setHistory(newHistory);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(newHistory));
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [query, result, sessionId, history]);

  // ── Push Live handler (D-305) ─────────────────────────────────────────────

  const handlePushLive = useCallback(async () => {
    const sql = editedSql !== null ? editedSql : result?.sql || '';
    if (!sql.trim()) return;
    if (!pushLiveEnabled) return;

    setIsDeploying(true);
    setDeployment(null);
    setError(null);

    try {
      const response = await fetch('/api/query/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Deploy failed');
      }

      const data = await response.json();
      setDeployment({ jobId: data.jobId, outputTopic: data.outputTopic });
    } catch (err) {
      setError(err.message);
    } finally {
      setIsDeploying(false);
    }
  }, [editedSql, result, pushLiveEnabled]);

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e) => {
      // Cmd/Ctrl + Enter → Generate SQL
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      }
      // Cmd/Ctrl + Shift + Enter → Push Live
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'Enter') {
        e.preventDefault();
        handlePushLive();
      }
    },
    [handleSubmit, handlePushLive]
  );

  // ── Re-validate handler ───────────────────────────────────────────────────

  const handleRevalidate = useCallback(async (sql) => {
    setIsValidating(true);
    try {
      const response = await fetch('/api/query/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql }),
      });
      const validation = await response.json();
      setResult((prev) => ({
        ...prev,
        sql,
        validation: {
          status: validation.status,
          attempts: prev?.validation?.attempts,
          syntaxErrors: validation.syntaxErrors,
          catalogIssues: validation.catalogIssues,
        },
      }));
    } catch {
      // Non-fatal — keep existing validation state
    } finally {
      setIsValidating(false);
    }
  }, []);

  // ── SQL change handler ────────────────────────────────────────────────────

  const handleSqlChange = useCallback((value) => {
    setEditedSql(value || '');
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  const hasResult = Boolean(result);
  const textareaPlaceholder = hasResult
    ? 'Refine: e.g., "make it weekly instead of daily"'
    : 'Describe the data you want to see... e.g., "customer return rates by product for the last 3 weeks"';

  return (
    <div className="flex h-full min-h-0 bg-gray-900 text-gray-200">
      {/* ── Schema sidebar ── */}
      <SchemaSidebar
        schemas={schemas}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
      />

      {/* ── Main panel ── */}
      <div className="flex-1 flex flex-col gap-4 p-4 overflow-y-auto min-w-0">
        {/* Back to topic browser */}
        {onNavigateToTopics && (
          <button
            onClick={onNavigateToTopics}
            className="self-start text-xs text-gray-500 hover:text-cyan-400 transition-colors"
          >
            &#8592; Topic Browser
          </button>
        )}

        {/* ── NLP input ── */}
        <div className="flex flex-col gap-2">
          <label htmlFor="nlp-input" className="text-sm font-semibold text-gray-300">
            Query Builder
          </label>

          {/* Example prompts */}
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                onClick={() => setQuery(prompt)}
                className="px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-cyan-400 border border-gray-700 rounded-md transition-colors"
              >
                {prompt}
              </button>
            ))}
          </div>

          {/* Textarea */}
          <textarea
            id="nlp-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={textareaPlaceholder}
            rows={3}
            disabled={isLoading}
            className={
              'w-full bg-gray-800 border border-gray-700 rounded-md p-3 text-sm text-gray-200 ' +
              'placeholder-gray-500 resize-none ' +
              'focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent ' +
              (isLoading ? 'opacity-50 cursor-not-allowed' : '')
            }
          />

          <div className="flex items-center gap-3">
            <button
              onClick={handleSubmit}
              disabled={isLoading || !query.trim()}
              className={
                'px-4 py-2 text-sm font-semibold rounded-md transition-colors ' +
                (isLoading || !query.trim()
                  ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                  : 'bg-cyan-600 hover:bg-cyan-500 text-white cursor-pointer')
              }
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <span
                    className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"
                    aria-hidden="true"
                  />
                  Generating...
                </span>
              ) : (
                'Generate SQL'
              )}
            </button>
            <span className="text-xs text-gray-500">or ⌘↵</span>
          </div>
        </div>

        {/* ── Error display ── */}
        {error && (
          <div className="border border-red-700 bg-red-900/20 rounded-md p-3 flex items-center justify-between">
            <p className="text-sm text-red-400">{error}</p>
            <button
              onClick={() => { setError(null); handleSubmit(); }}
              className="ml-3 text-xs text-red-400 hover:text-red-200 underline"
            >
              Try again
            </button>
          </div>
        )}

        {/* ── SQL editor ── */}
        {(displaySql || isLoading) && (
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-gray-300">Generated SQL</h2>
            <SqlEditor
              sql={displaySql}
              onChange={handleSqlChange}
              onValidate={handleRevalidate}
              validationStatus={validationStatus}
              isProcessing={isValidating}
            />

            {/* ── Push Live button row (D-305) ── */}
            <div className="flex items-center gap-3">
              <button
                onClick={handlePushLive}
                disabled={!pushLiveEnabled}
                className={
                  'px-4 py-2.5 text-sm font-semibold rounded-md transition-colors ' +
                  (isDeploying
                    ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                    : jobIsActive
                    ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                    : !pushLiveEnabled
                    ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                    : 'bg-cyan-600 hover:bg-cyan-500 text-white cursor-pointer')
                }
                title={
                  validationStatus === 'red' || validationStatus === null
                    ? 'Fix validation errors before pushing live'
                    : undefined
                }
              >
                {isDeploying ? (
                  <span className="flex items-center gap-2">
                    <span
                      className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"
                      aria-hidden="true"
                    />
                    Submitting...
                  </span>
                ) : jobIsActive ? (
                  'Job Running'
                ) : (
                  'Push Live'
                )}
              </button>
              <span className="text-xs text-gray-500">or ⌘⇧↵</span>
            </div>
          </div>
        )}

        {/* ── Deployment Status Panel (D-306) ── */}
        {deployment && (
          <DeploymentStatusPanel
            jobId={deployment.jobId}
            outputTopic={deployment.outputTopic}
            onClose={() => setDeployment(null)}
            onStopped={() => {
              // Refresh schemas to keep derived topic visible in sidebar
              refreshSchemas();
            }}
            onRetry={handlePushLive}
            onEditSql={() => {
              // Return focus to the SQL editor area (scroll into view)
              document.getElementById('nlp-input')?.scrollIntoView({ behavior: 'smooth' });
            }}
          />
        )}

        {/* ── Sample output ── */}
        {result && (result.mockRows?.length > 0 || result.outputSchema?.length > 0) && (
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-gray-300">Sample Output</h2>
            <SampleOutput
              mockRows={result.mockRows}
              outputSchema={result.outputSchema}
              reasoning={result.reasoning}
            />
          </div>
        )}

        {/* ── Validation warnings / catalog issues ── */}
        {result?.validation?.catalogIssues?.length > 0 && (
          <div className="border border-yellow-700/50 bg-yellow-900/10 rounded-md p-3">
            <p className="text-xs font-semibold text-yellow-400 mb-1">Catalog warnings</p>
            <ul className="list-disc list-inside space-y-0.5">
              {result.validation.catalogIssues.map((issue, i) => (
                <li key={i} className="text-xs text-yellow-300">{issue}</li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Recent history ── */}
        {history.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Recent Queries
            </h3>
            <ul className="space-y-1">
              {history.map(({ query: q, timestamp }, idx) => (
                <li key={idx}>
                  <button
                    onClick={() => setQuery(q)}
                    className="w-full text-left text-xs text-gray-400 hover:text-cyan-400 px-2 py-1 rounded hover:bg-gray-800 transition-colors truncate block"
                    title={q}
                  >
                    <span className="text-gray-600 mr-2">
                      {new Date(timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    {q}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
