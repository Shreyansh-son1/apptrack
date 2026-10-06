import {
  applicationsSent,
  responseRate,
  type Stats,
} from '../../shared/index';

interface Props {
  stats: Stats;
}

function formatRate(rate: number | null): string {
  return rate === null ? '\u2014' : `${Math.round(rate * 100)}%`;
}

/**
 * Numbers only, no chart: the pipeline is seven small counts and a
 * ratio, which read faster as figures than as bars. All the arithmetic
 * lives in shared code (see responseRate), so it is unit tested.
 */
export function StatsStrip({ stats }: Props): JSX.Element {
  const sent = applicationsSent(stats.byStatus);
  const tiles: Array<{ label: string; value: string; hint?: string }> = [
    { label: 'Tracked', value: String(stats.total) },
    { label: 'Sent', value: String(sent) },
    { label: 'Interviewing', value: String(stats.byStatus.interview) },
    { label: 'Offers', value: String(stats.byStatus.offer) },
    {
      label: 'Response rate',
      value: formatRate(responseRate(stats.byStatus)),
      hint: 'Any reply, rejections included, out of applications sent',
    },
  ];

  return (
    <dl className="stats-strip" aria-label="Pipeline summary">
      {tiles.map((tile) => (
        <div key={tile.label} className="stat" title={tile.hint}>
          <dt>{tile.label}</dt>
          <dd>{tile.value}</dd>
        </div>
      ))}
    </dl>
  );
}
