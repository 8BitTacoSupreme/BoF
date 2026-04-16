/**
 * SqlEditor.jsx
 *
 * Monaco-based SQL editor with validation indicator and re-validate button.
 *
 * Props:
 *   sql            {string}        SQL content to display
 *   onChange       {function}      Called with new SQL string on editor change
 *   onValidate     {function}      Called with current SQL when user clicks "Re-validate"
 *   validationStatus {string|null} 'green' | 'yellow' | 'red' | null
 *   isProcessing   {boolean}       Disables button and shows "Validating..."
 */

import Editor from '@monaco-editor/react';
import ValidationIndicator from './ValidationIndicator';

export default function SqlEditor({
  sql,
  onChange,
  onValidate,
  validationStatus,
  isProcessing,
}) {
  const handleValidateClick = () => {
    if (onValidate) onValidate(sql || '');
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-md overflow-hidden border border-gray-700">
        <Editor
          height="300px"
          language="sql"
          theme="vs-dark"
          value={sql || ''}
          onChange={onChange}
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            wordWrap: 'on',
            scrollBeyondLastLine: false,
            lineNumbers: 'on',
            padding: { top: 8, bottom: 8 },
          }}
        />
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={handleValidateClick}
          disabled={isProcessing}
          className={
            'px-3 py-1.5 text-sm rounded-md font-medium transition-colors ' +
            (isProcessing
              ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
              : 'bg-gray-700 hover:bg-gray-600 text-gray-200 cursor-pointer')
          }
        >
          {isProcessing ? 'Validating...' : 'Re-validate'}
        </button>

        <ValidationIndicator status={validationStatus} />
      </div>
    </div>
  );
}
