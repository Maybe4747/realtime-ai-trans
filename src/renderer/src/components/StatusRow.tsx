interface StatusRowProps {
  label: string
  text: string
  value: string
}

export function StatusRow({ label, text, value }: StatusRowProps): React.JSX.Element {
  return (
    <div className="insight-row">
      <div>
        <strong>{label}</strong>
        <span>{text}</span>
      </div>
      <span className="micro-value">{value}</span>
    </div>
  )
}
