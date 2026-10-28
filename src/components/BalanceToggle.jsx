import { Eye, EyeOff } from 'lucide-react'

export default function BalanceToggle({ hidden, onToggle, className = '' }) {
  const label = hidden ? 'Show balances' : 'Hide balances'
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={hidden}
      aria-label={label}
      title={label}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] transition ${className}`}
    >
      {hidden ? <Eye className="h-3.5 w-3.5" aria-hidden="true" /> : <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />}
      {hidden ? 'Show' : 'Hide'}
    </button>
  )
}
