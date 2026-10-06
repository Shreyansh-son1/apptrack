import { useState } from 'react';
import {
  ALLOWED_TRANSITIONS,
  SOURCES,
  STATUSES,
  describeStatus,
  type Application,
  type ApplicationInput,
  type Source,
  type Status,
} from '../../shared/index';

/**
 * One form for both jobs. With no `initial` it adds a record; with one it
 * edits that record. Keeping a single component means the fields, the
 * labels and the error display cannot drift between "add" and "edit".
 */
interface Props {
  fieldErrors: Record<string, string[]>;
  onSubmit: (input: ApplicationInput) => void;
  /** Present when editing an existing application. */
  initial?: Application;
  /** Present when editing; lets the person back out without saving. */
  onCancel?: () => void;
}

/**
 * The form's own state is loose strings, because that is what inputs
 * produce. It is converted to a typed input only at submit, and the
 * server validates it again. The two are not the same job: this shape
 * exists so a half-filled form is representable.
 */
interface FormState {
  company: string;
  role: string;
  source: Source;
  status: Status;
  appliedOn: string;
  followUpOn: string;
  url: string;
  notes: string;
}

function emptyState(): FormState {
  return {
    company: '',
    role: '',
    source: 'linkedin',
    status: 'applied',
    appliedOn: new Date().toISOString().slice(0, 10),
    followUpOn: '',
    url: '',
    notes: '',
  };
}

function stateFrom(application: Application): FormState {
  return {
    company: application.company,
    role: application.role,
    source: application.source,
    status: application.status,
    appliedOn: application.appliedOn ?? '',
    followUpOn: application.followUpOn ?? '',
    url: application.url ?? '',
    notes: application.notes,
  };
}

const SOURCE_LABELS: Record<Source, string> = {
  linkedin: 'LinkedIn',
  naukri: 'Naukri',
  referral: 'Referral',
  'company-site': 'Company site',
  other: 'Other',
};

export function ApplicationForm({
  fieldErrors,
  onSubmit,
  initial,
  onCancel,
}: Props): JSX.Element {
  const editing = initial !== undefined;
  const [form, setForm] = useState<FormState>(
    initial === undefined ? emptyState() : stateFrom(initial),
  );

  /*
   * When editing, the status menu offers only moves the server would
   * accept, the same rule the row's dropdown uses. When adding, any
   * starting status is fine.
   */
  const statusOptions: readonly Status[] =
    initial === undefined
      ? STATUSES
      : [initial.status, ...ALLOWED_TRANSITIONS[initial.status]];

  function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  function submit(): void {
    onSubmit({
      company: form.company,
      role: form.role,
      source: form.source,
      status: form.status,
      appliedOn: form.appliedOn === '' ? null : form.appliedOn,
      followUpOn: form.followUpOn === '' ? null : form.followUpOn,
      url: form.url === '' ? null : form.url,
      notes: form.notes,
    });
    if (!editing) setForm(emptyState());
  }

  function errorFor(field: keyof FormState): string | null {
    return fieldErrors[field]?.join('. ') ?? null;
  }

  return (
    <section className="panel">
      <h2 className="panel-title">
        {editing ? `Edit ${initial.company}` : 'Add an application'}
      </h2>

      <div className="field-grid">
        <label className="field">
          <span>Company</span>
          <input
            value={form.company}
            onChange={(event) => {
              set('company', event.target.value);
            }}
            placeholder="Flexiple"
          />
          {errorFor('company') !== null && (
            <em className="field-error">{errorFor('company')}</em>
          )}
        </label>

        <label className="field">
          <span>Role</span>
          <input
            value={form.role}
            onChange={(event) => {
              set('role', event.target.value);
            }}
            placeholder="Full Stack Developer"
          />
          {errorFor('role') !== null && <em className="field-error">{errorFor('role')}</em>}
        </label>

        <label className="field">
          <span>Found via</span>
          <select
            value={form.source}
            onChange={(event) => {
              set('source', event.target.value as Source);
            }}
          >
            {SOURCES.map((source) => (
              <option key={source} value={source}>
                {SOURCE_LABELS[source]}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Status</span>
          <select
            value={form.status}
            onChange={(event) => {
              set('status', event.target.value as Status);
            }}
          >
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {describeStatus(status)}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Applied on</span>
          <input
            type="date"
            value={form.appliedOn}
            onChange={(event) => {
              set('appliedOn', event.target.value);
            }}
          />
          {errorFor('appliedOn') !== null && (
            <em className="field-error">{errorFor('appliedOn')}</em>
          )}
        </label>

        <label className="field">
          <span>Follow up on</span>
          <input
            type="date"
            value={form.followUpOn}
            onChange={(event) => {
              set('followUpOn', event.target.value);
            }}
          />
          {errorFor('followUpOn') !== null && (
            <em className="field-error">{errorFor('followUpOn')}</em>
          )}
        </label>

        <label className="field field-wide">
          <span>Posting link</span>
          <input
            value={form.url}
            onChange={(event) => {
              set('url', event.target.value);
            }}
            placeholder="https://"
          />
          {errorFor('url') !== null && <em className="field-error">{errorFor('url')}</em>}
        </label>

        <label className="field field-wide">
          <span>Notes</span>
          <input
            value={form.notes}
            onChange={(event) => {
              set('notes', event.target.value);
            }}
            placeholder="Referral from quiz club, resume tailored for RAG project"
          />
        </label>
      </div>

      <div className="form-actions">
        <button type="button" className="primary" onClick={submit}>
          {editing ? 'Save changes' : 'Save application'}
        </button>
        {onCancel !== undefined && (
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </section>
  );
}
