import {
  ALLOWED_TRANSITIONS,
  describeStatus,
  isFollowUpDue,
  type Application,
  type Status,
} from '../../shared/index';

interface Props {
  application: Application;
  today: string;
  onStatusChange: (id: string, status: Status) => void;
  onDelete: (id: string) => void;
}

function formatDate(value: string | null): string {
  if (value === null) return '';
  const [year, month, day] = value.split('-');
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const index = Number(month) - 1;
  return `${day} ${months[index] ?? month} ${year?.slice(2) ?? ''}`;
}

export function ApplicationRow({
  application,
  today,
  onStatusChange,
  onDelete,
}: Props): JSX.Element {
  const due = isFollowUpDue(application, today);

  /*
   * The dropdown only offers moves the server would accept. The rule
   * lives in shared code, so the UI and the API cannot disagree about
   * what is legal.
   */
  const options: Status[] = [
    application.status,
    ...ALLOWED_TRANSITIONS[application.status],
  ];

  return (
    <li className={due ? 'row row-due' : 'row'}>
      <div className="row-main">
        <p className="row-company">{application.company}</p>
        <p className="row-role">
          {application.url === null ? (
            application.role
          ) : (
            <a href={application.url} target="_blank" rel="noreferrer">
              {application.role}
            </a>
          )}
        </p>
        {application.notes !== '' && <p className="row-notes">{application.notes}</p>}
      </div>

      <div className="row-dates">
        {application.appliedOn !== null && (
          <span className="row-date">Applied {formatDate(application.appliedOn)}</span>
        )}
        {application.followUpOn !== null && (
          <span className={due ? 'row-date row-date-due' : 'row-date'}>
            {due ? 'Follow up now' : `Follow up ${formatDate(application.followUpOn)}`}
          </span>
        )}
      </div>

      <div className="row-actions">
        <select
          className="row-status"
          value={application.status}
          aria-label={`Status for ${application.company}`}
          onChange={(event) => {
            onStatusChange(application.id, event.target.value as Status);
          }}
        >
          {options.map((status) => (
            <option key={status} value={status}>
              {describeStatus(status)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="row-delete"
          onClick={() => {
            onDelete(application.id);
          }}
        >
          Remove
        </button>
      </div>
    </li>
  );
}
