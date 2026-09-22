import { useState } from 'react';
import type { ImportResult } from '../../shared/index';

interface Props {
  onImport: (text: string) => Promise<ImportResult>;
}

const SAMPLE = `company,role,status,appliedOn,followUpOn
Flexiple,Full Stack Developer,applied,2026-09-18,2026-09-25`;

export function ImportPanel({ onImport }: Props): JSX.Element {
  const [text, setText] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(): Promise<void> {
    setBusy(true);
    try {
      setResult(await onImport(text));
      setText('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2 className="panel-title">Import from a spreadsheet</h2>
      <p className="panel-note">
        Paste CSV with a header row. Rows that fail validation are reported
        below and left out; the rest still import.
      </p>

      <textarea
        className="import-box"
        rows={5}
        spellCheck={false}
        value={text}
        placeholder={SAMPLE}
        onChange={(event) => {
          setText(event.target.value);
        }}
      />

      <button
        type="button"
        className="primary"
        disabled={busy || text.trim() === ''}
        onClick={() => {
          void run();
        }}
      >
        {busy ? 'Importing' : 'Import rows'}
      </button>

      {result !== null && (
        <div className="import-result">
          <p>
            Imported {result.imported}, skipped {result.skipped}.
          </p>
          {result.errors.length > 0 && (
            <ul className="import-errors">
              {result.errors.map((error) => (
                <li key={error.row}>
                  Row {error.row}: {error.issues.join(' / ')}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
