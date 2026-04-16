/**
 * ValidationIndicator.jsx
 *
 * Traffic light status indicator for Flink SQL validation.
 *
 * Props:
 *   status: 'green' | 'yellow' | 'red' | null
 */

const STATUS_CONFIG = {
  green: {
    color: 'bg-green-500',
    hex: '#22c55e',
    label: 'Valid — all fields resolved',
  },
  yellow: {
    color: 'bg-yellow-400',
    hex: '#eab308',
    label: 'Valid syntax — uncertain field mapping',
  },
  red: {
    color: 'bg-red-500',
    hex: '#ef4444',
    label: 'Validation failed',
  },
};

export default function ValidationIndicator({ status }) {
  const config = status ? STATUS_CONFIG[status] : null;
  const dotColor = config ? config.color : 'bg-gray-500';
  const label = config ? config.label : 'Not validated';
  const ariaLabel = `Validation status: ${label}`;

  return (
    <span
      className="inline-flex items-center gap-2 text-sm text-gray-400"
      aria-label={ariaLabel}
      role="status"
    >
      <span
        className={`w-3 h-3 rounded-full inline-block ${dotColor}`}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
