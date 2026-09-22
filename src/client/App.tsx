import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  STATUSES,
  describeStatus,
  todayIso,
  type Application,
  type ApplicationInput,
  type Stats,
  type Status,
} from '../shared/index';
import { api, ApiError } from './api';
import { ApplicationRow } from './components/ApplicationRow';
import { NewApplicationForm } from './components/NewApplicationForm';
import { ImportPanel } from './components/ImportPanel';

/**
 * Which slice of the list is on screen. A discriminated union rather than
 * a pair of nullable fields, because "a status filter" and "the due
 * filter" are mutually exclusive and the compiler can enforce that.
 */
type Filter =
  | { kind: 'all' }
  | { kind: 'due' }
  | { kind: 'status'; status: Status };

export function App(): JSX.Element {
  const [applications, setApplications] = useState<Application[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const [search, setSearch] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const today = useMemo(() => todayIso(), []);

  const refresh = useCallback(async (): Promise<void> => {
    const query = {
      ...(filter.kind === 'status' ? { status: filter.status } : {}),
      ...(filter.kind === 'due' ? { dueOnly: true } : {}),
      ...(search === '' ? {} : { q: search }),
    };
    const [list, nextStats] = await Promise.all([api.list(query), api.stats()]);
    setApplications(list);
    setStats(nextStats);
    setLoading(false);
  }, [filter, search]);

  useEffect(() => {
    void refresh().catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : 'Could not load applications');
      setLoading(false);
    });
  }, [refresh]);

  /** Routes any thrown value into either field errors or a banner. */
  function handleFailure(error: unknown): void {
    if (error instanceof ApiError) {
      setFieldErrors(error.fields);
      setMessage(Object.keys(error.fields).length > 0 ? null : error.message);
      return;
    }
    setMessage(error instanceof Error ? error.message : 'Something went wrong');
  }

  async function create(input: ApplicationInput): Promise<void> {
    try {
      await api.create(input);
      setFieldErrors({});
      setMessage(null);
      await refresh();
    } catch (error: unknown) {
      handleFailure(error);
    }
  }

  async function changeStatus(id: string, status: Status): Promise<void> {
    const current = applications.find((a) => a.id === id);
    const patch =
      status !== 'saved' && current?.appliedOn === null
        ? { status, appliedOn: today }
        : { status };

    try {
      await api.update(id, patch);
      setMessage(null);
      await refresh();
    } catch (error: unknown) {
      handleFailure(error);
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      await api.remove(id);
      await refresh();
    } catch (error: unknown) {
      handleFailure(error);
    }
  }

  const dueCount = stats?.dueCount ?? 0;

  return (
    <div className="shell">
      <header className="masthead">
        <div>
          <h1>apptrack</h1>
          <p className="masthead-note">
            {stats === null
              ? 'Loading'
              : `${stats.total} applications tracked`}
          </p>
        </div>
        <p className={dueCount > 0 ? 'due-headline due-headline-active' : 'due-headline'}>
          {dueCount === 0
            ? 'Nothing needs chasing today'
            : `${dueCount} need${dueCount === 1 ? 's' : ''} a follow-up today`}
        </p>
      </header>

      {message !== null && (
        <p className="banner" role="alert">
          {message}
        </p>
      )}

      <div className="layout">
        <nav className="rail" aria-label="Filters">
          <button
            type="button"
            className={filter.kind === 'all' ? 'rail-item rail-item-on' : 'rail-item'}
            onClick={() => {
              setFilter({ kind: 'all' });
            }}
          >
            <span>Everything</span>
            <span className="rail-count">{stats?.total ?? 0}</span>
          </button>

          <button
            type="button"
            className={filter.kind === 'due' ? 'rail-item rail-item-on' : 'rail-item'}
            onClick={() => {
              setFilter({ kind: 'due' });
            }}
          >
            <span>Needs a follow-up</span>
            <span className="rail-count">{dueCount}</span>
          </button>

          <hr className="rail-divider" />

          {STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              className={
                filter.kind === 'status' && filter.status === status
                  ? 'rail-item rail-item-on'
                  : 'rail-item'
              }
              onClick={() => {
                setFilter({ kind: 'status', status });
              }}
            >
              <span>{describeStatus(status)}</span>
              <span className="rail-count">{stats?.byStatus[status] ?? 0}</span>
            </button>
          ))}
        </nav>

        <main className="main">
          <input
            className="search"
            value={search}
            placeholder="Search company, role or notes"
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />

          {loading ? (
            <p className="empty">Loading applications</p>
          ) : applications.length === 0 ? (
            <p className="empty">
              Nothing here yet. Add an application below, or paste a CSV export.
            </p>
          ) : (
            <ul className="rows">
              {applications.map((application) => (
                <ApplicationRow
                  key={application.id}
                  application={application}
                  today={today}
                  onStatusChange={(id, status) => {
                    void changeStatus(id, status);
                  }}
                  onDelete={(id) => {
                    void remove(id);
                  }}
                />
              ))}
            </ul>
          )}

          <NewApplicationForm
            fieldErrors={fieldErrors}
            onSubmit={(input) => {
              void create(input);
            }}
          />

          <ImportPanel
            onImport={async (text) => {
              const result = await api.importCsv(text);
              await refresh();
              return result;
            }}
          />
        </main>
      </div>
    </div>
  );
}
