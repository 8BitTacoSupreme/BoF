/**
 * App.jsx — bride-of-flinkenstein root component.
 *
 * Navigation:
 *   "Topics"        → Phase 1 topic browser (placeholder until Phase 1 UI is built)
 *   "Query Builder" → Phase 2 NLP → SQL → sample output (QueryBuilder)
 */

import { useState } from 'react';
import QueryBuilder from './components/QueryBuilder';

const VIEWS = {
  TOPICS: 'topics',
  QUERY_BUILDER: 'query-builder',
};

// ─────────────────────────────────────────────────────────────────────────────
// TopicBrowserPlaceholder — Phase 1 UI lives here when built
// ─────────────────────────────────────────────────────────────────────────────

function TopicBrowserPlaceholder({ onNavigateToQueryBuilder }) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-4 text-gray-500">
      <p className="text-lg text-gray-400">Topic Browser</p>
      <p className="text-sm text-gray-600">Phase 1 infrastructure — coming soon.</p>
      <button
        onClick={onNavigateToQueryBuilder}
        className="px-4 py-2 bg-cyan-700 hover:bg-cyan-600 text-white text-sm rounded-md transition-colors"
      >
        Go to Query Builder
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// App
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [activeView, setActiveView] = useState(VIEWS.QUERY_BUILDER);

  return (
    <div className="bg-gray-900 text-white min-h-screen flex flex-col font-sans">
      {/* ── Header ── */}
      <header className="bg-gray-800/50 backdrop-blur-sm border-b border-gray-700 px-6 h-14 flex items-center justify-between flex-shrink-0">
        <h1 className="text-xl font-semibold">
          <span className="text-gray-400">bride of </span>
          <span className="text-cyan-400">flink</span>
          <span className="text-purple-400">enstein</span>
        </h1>

        {/* Navigation tabs */}
        <nav role="tablist" className="flex items-center gap-1">
          <button
            role="tab"
            aria-selected={activeView === VIEWS.TOPICS}
            onClick={() => setActiveView(VIEWS.TOPICS)}
            className={
              'px-3 py-1.5 text-sm rounded-md transition-colors ' +
              (activeView === VIEWS.TOPICS
                ? 'bg-gray-700 text-white font-semibold'
                : 'text-gray-400 hover:text-gray-200')
            }
          >
            Topics
          </button>
          <button
            role="tab"
            aria-selected={activeView === VIEWS.QUERY_BUILDER}
            onClick={() => setActiveView(VIEWS.QUERY_BUILDER)}
            className={
              'px-3 py-1.5 text-sm rounded-md transition-colors ' +
              (activeView === VIEWS.QUERY_BUILDER
                ? 'bg-gray-700 text-white font-semibold'
                : 'text-gray-400 hover:text-gray-200')
            }
          >
            Query Builder
          </button>
        </nav>
      </header>

      {/* ── Main content ── */}
      <main className="flex-1 flex min-h-0" role="tabpanel">
        {activeView === VIEWS.TOPICS ? (
          <TopicBrowserPlaceholder
            onNavigateToQueryBuilder={() => setActiveView(VIEWS.QUERY_BUILDER)}
          />
        ) : (
          <QueryBuilder onNavigateToTopics={() => setActiveView(VIEWS.TOPICS)} />
        )}
      </main>
    </div>
  );
}
