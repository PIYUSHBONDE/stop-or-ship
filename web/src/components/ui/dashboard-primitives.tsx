import { ArrowUpRight, CircleHelp } from 'lucide-react';
import type { ReactNode } from 'react';

export function Metric({
  label,
  value,
  unit,
  icon,
  note,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  unit?: string;
  icon: ReactNode;
  note: string;
  tone: string;
  onClick?: () => void;
}) {
  return (
    <div className="metric panel">
      <div className="metric-top">
        <span>{label}</span>
        <span className={`metric-icon ${tone}`}>{icon}</span>
      </div>
      <div className="metric-value">
        {value}
        <small>{unit}</small>
      </div>
      <div className={`metric-note ${tone}`}>
        {tone === 'green' ? <ArrowUpRight size={12} /> : <CircleHelp size={12} />}{' '}
        {onClick ? <button onClick={onClick}>{note}</button> : note}
      </div>
    </div>
  );
}
export function Empty({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
