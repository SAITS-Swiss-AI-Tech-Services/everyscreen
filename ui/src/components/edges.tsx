import type { Edge, EdgeProps } from '@xyflow/react';
import { CATS } from '../board';

// Edge geometry is computed once by layout.ts (frames never move), so the edge
// component just draws the stored path.
export type RoutedEdgeType = Edge<{ d: string; cls: string }, 'routed'>;

export function RoutedEdge({ data, markerEnd }: EdgeProps<RoutedEdgeType>) {
  return <path d={data!.d} className={`e ${data!.cls}`} markerEnd={markerEnd} fill="none" />;
}

export const edgeTypes = { routed: RoutedEdge };

/** Arrowheads for every edge colour, referenced as markerEnd: 'm-<id>'. */
export function EdgeMarkers() {
  const markers = [...CATS.map((c) => ({ id: c.id, color: c.color })), { id: 'guessed', color: 'var(--e-guessed)' }, { id: 'out', color: 'var(--dir-out)' }, { id: 'in', color: 'var(--dir-in)' }];
  return (
    <svg className="edge-markers" aria-hidden="true">
      <defs>
        {markers.map((m) => (
          <marker key={m.id} id={`m-${m.id}`} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse" markerUnits="strokeWidth">
            <path d="M0,0 L10,5 L0,10 z" style={{ fill: m.color }} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}
