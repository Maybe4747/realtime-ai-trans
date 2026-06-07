interface ReadOnlyRowProps {
  label: string
  value: string
}

export function ReadOnlyRow({ label, value }: ReadOnlyRowProps): React.JSX.Element {
  return (
    <div className="setting-row">
      <div className="setting-label">
        <strong>{label}</strong>
      </div>
      <div className="control">
        <input className="field short" readOnly value={value} />
      </div>
    </div>
  )
}

interface RangeRowProps {
  label: string
  max: number
  min: number
  suffix: string
  value: number
  onChange: (value: number) => void
}

export function RangeRow({
  label,
  max,
  min,
  onChange,
  suffix,
  value
}: RangeRowProps): React.JSX.Element {
  return (
    <div className="setting-row">
      <div className="setting-label">
        <strong>{label}</strong>
      </div>
      <div className="control">
        <input
          className="slider"
          max={max}
          min={min}
          type="range"
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span className="micro-value">
          {value}
          {suffix}
        </span>
      </div>
    </div>
  )
}

interface SwitchRowProps {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}

export function SwitchRow({ checked, label, onChange }: SwitchRowProps): React.JSX.Element {
  return (
    <div className="setting-row">
      <div className="setting-label">
        <strong>{label}</strong>
      </div>
      <div className="control">
        <button
          aria-pressed={checked}
          className={checked ? 'toggle' : 'toggle off'}
          onClick={() => onChange(!checked)}
        />
      </div>
    </div>
  )
}
