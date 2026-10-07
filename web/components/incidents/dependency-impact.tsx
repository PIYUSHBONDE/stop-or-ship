import { ArrowDown, ArrowRight } from 'lucide-react';
import type { State } from '@/lib/types';
import styles from './incidents.module.css';

export function DependencyImpact({ state, assetId }: { state: State; assetId: string }) {
  const source = state.assets.find((asset) => asset.id === assetId);
  const branches = state.dependencies.filter((edge) => edge.source === assetId);

  function node(id: string, visited: Set<string>): React.ReactNode {
    const asset = state.assets.find((candidate) => candidate.id === id);
    if (visited.has(id)) return <span className={styles.node}>Dependency cycle · {id}</span>;
    const path = new Set([...visited, id]);
    const children = state.dependencies.filter((edge) => edge.source === id);
    return (
      <div className={styles.dependencyNode}>
        <span className={styles.node} data-testid={`dependency-node-${id}`}>
          <strong>{id}</strong>
          <small>
            {asset?.name || 'Equipment'}
            {asset?.type === 'goods' ? ' · shared destination' : ''}
          </small>
        </span>
        {children.length > 0 && (
          <ul>
            {children.map((edge) => (
              <li key={`${edge.source}-${edge.target}`}>
                <span className={styles.relationship}>
                  <ArrowDown size={12} aria-hidden="true" />
                  {edge.relationship}
                </span>
                {node(edge.target, path)}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className={styles.impact}>
      <div className={styles.impactSource}>
        <strong>{assetId}</strong>
        <span>{source?.name}</span>
      </div>
      <div className={styles.branches}>
        {branches.map((edge) => {
          const areaId = state.assets.find((asset) => asset.id === edge.target)?.area_id;
          const area =
            state.areas.find((candidate) => candidate.id === areaId)?.name || 'Dependent equipment';
          return (
            <section
              className={styles.branch}
              aria-label={`${area} dependency branch`}
              key={edge.target}
            >
              <h3>
                <ArrowRight size={14} aria-hidden="true" />
                {area}
                <span>{edge.relationship}</span>
              </h3>
              {node(edge.target, new Set([assetId]))}
            </section>
          );
        })}
      </div>
      {!branches.length && (
        <p className="muted">No downstream dependencies are configured for this equipment.</p>
      )}
      <p className={styles.note}>
        Configured plant dependencies. Shared destinations collect both branches; each affected
        production line is counted once.
      </p>
    </div>
  );
}
