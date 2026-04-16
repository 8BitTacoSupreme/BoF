/**
 * SampleOutput.jsx
 *
 * Table / JSON toggle view for LLM-generated mock rows.
 *
 * Props:
 *   mockRows     {Array<Object>}              Rows to display
 *   outputSchema {Array<{field, type}>}       Column definitions
 *   reasoning    {string}                     LLM reasoning text
 */

import { useState } from 'react';

export default function SampleOutput({ mockRows = [], outputSchema = [], reasoning }) {
  const [view, setView] = useState('table');

  const isEmpty = !mockRows || mockRows.length === 0;

  // Derive column names from outputSchema; fall back to first row keys
  const columns =
    outputSchema && outputSchema.length > 0
      ? outputSchema.map((s) => s.field)
      : mockRows.length > 0
      ? Object.keys(mockRows[0])
      : [];

  return (
    <div className="flex flex-col gap-3">
      {/* Reasoning */}
      {reasoning && (
        <p className="text-xs text-gray-500 italic">
          Reasoning: {reasoning}
        </p>
      )}

      {/* View toggle */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setView('table')}
          className={
            'px-3 py-1 text-xs rounded-md font-medium transition-colors ' +
            (view === 'table'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600')
          }
        >
          Table
        </button>
        <button
          onClick={() => setView('json')}
          className={
            'px-3 py-1 text-xs rounded-md font-medium transition-colors ' +
            (view === 'json'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600')
          }
        >
          JSON
        </button>
      </div>

      {/* Content */}
      {isEmpty ? (
        <p className="text-sm text-gray-500">No sample data available</p>
      ) : view === 'table' ? (
        <div className="overflow-x-auto rounded-md border border-gray-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-900 text-gray-400 text-xs uppercase tracking-wider">
                {columns.map((col) => (
                  <th key={col} className="px-4 py-2 text-left font-medium whitespace-nowrap">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mockRows.map((row, idx) => (
                <tr
                  key={idx}
                  className={
                    idx % 2 === 0
                      ? 'bg-gray-800 border-b border-gray-700/50'
                      : 'bg-gray-900/50 border-b border-gray-700/50'
                  }
                >
                  {columns.map((col) => (
                    <td
                      key={col}
                      className="px-4 py-2 text-gray-200 font-mono text-xs max-w-xs truncate"
                      title={String(row[col] ?? '')}
                    >
                      {String(row[col] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-gray-900 rounded-md border border-gray-700 p-4 max-h-64 overflow-y-auto">
          <pre className="text-xs text-gray-300 whitespace-pre-wrap">
            {JSON.stringify(mockRows, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
