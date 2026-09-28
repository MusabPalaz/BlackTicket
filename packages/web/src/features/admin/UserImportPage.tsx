import { useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Role, toCsv } from '@black-ticket/shared';
import { api, ApiError } from '@/lib/api';
import { Alert, Button, Card, Field, cx } from '@/components/ui';
import type { ImportResult } from './types';

const controlClass =
  'w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]';

const SAMPLE = `username,fullname,role
jdoe,Jane Doe,ANALYST
msmith,Mark Smith,SOC_LEAD
auditor1,Read Only Auditor,READ_ONLY`;

/**
 * Bulk account creation — the path that puts 600 people into the system.
 *
 * The dry run is the default and the button order says so: for a roster that
 * size, "check first" has to be the easy thing to do.
 */
export function UserImportPage() {
  const [csv, setCsv] = useState('');
  const [defaultRole, setDefaultRole] = useState<Role>(Role.ANALYST);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.post<ImportResult>('/admin/users/import', { csv, dryRun, defaultRole }),
    onSuccess: (response) => {
      setError(null);
      setResult(response);
    },
    onError: (caught) => {
      setResult(null);
      setError(caught instanceof ApiError ? caught.detail : 'Could not reach the server.');
    },
  });

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    void file.text().then(setCsv);
  }

  /** The temporary passwords exist only in this response — offer them once. */
  function downloadCredentials(rows: ImportResult['rows']) {
    const created = rows.filter((row) => row.temporaryPassword);
    const content = toCsv(
      ['username', 'email', 'role', 'temporaryPassword'],
      created.map((row) => [row.username, row.email ?? '', row.role ?? '', row.temporaryPassword ?? '']),
    );
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `black-ticket-credentials-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="max-w-4xl space-y-4 p-8">
      <header>
        <nav className="text-xs text-[var(--color-content-muted)]">
          <Link to="/admin/users" className="hover:underline">
            Accounts
          </Link>{' '}
          / Import
        </nav>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">Import accounts from CSV</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          Columns: <code>username</code> (required), <code>fullname</code>, <code>email</code>,{' '}
          <code>role</code>. Addresses are derived from the organisation domain when the e-mail
          column is missing.
        </p>
      </header>

      {error && <Alert>{error}</Alert>}

      <Card title="Source">
        <div className="space-y-3">
          <input type="file" accept=".csv,text/csv" onChange={onFile} className="text-sm" />
          <textarea
            rows={10}
            value={csv}
            onChange={(event) => setCsv(event.target.value)}
            placeholder={SAMPLE}
            className={cx(controlClass, 'font-mono text-xs')}
          />
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Role when the column is missing">
              <select
                value={defaultRole}
                onChange={(event) => setDefaultRole(event.target.value as Role)}
                className={controlClass}
              >
                {Object.values(Role).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </Field>
            <Button disabled={!csv.trim()} loading={run.isPending} onClick={() => run.mutate(true)}>
              Check without importing
            </Button>
            <Button
              variant="secondary"
              disabled={!csv.trim() || !result?.dryRun}
              loading={run.isPending}
              onClick={() => run.mutate(false)}
              title={result?.dryRun ? undefined : 'Run the check first'}
            >
              Import for real
            </Button>
          </div>
        </div>
      </Card>

      {result && (
        <Card
          title={
            result.dryRun
              ? `Dry run — ${result.created} would be created`
              : `Imported — ${result.created} account(s) created`
          }
        >
          <div className="mb-3 flex flex-wrap items-center gap-4 text-sm">
            <span>{result.total} row(s)</span>
            <span className="text-[var(--color-tlp-green)]">{result.created} ok</span>
            <span className="text-[var(--color-severity-medium)]">{result.skipped} skipped</span>
            <span className="text-[var(--color-severity-critical)]">{result.errors} error(s)</span>
            {!result.dryRun && result.created > 0 && (
              <Button className="px-3 py-1 text-xs" onClick={() => downloadCredentials(result.rows)}>
                Download credentials CSV
              </Button>
            )}
          </div>

          {!result.dryRun && result.created > 0 && (
            <Alert tone="warning">
              Temporary passwords are shown once. Download them now and hand them out over a channel
              you trust — every account must change its password at first sign-in.
            </Alert>
          )}

          <div className="mt-3 max-h-96 overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-[var(--color-content-muted)] uppercase">
                <tr>
                  <th className="pb-2 pr-3 font-medium">Line</th>
                  <th className="pb-2 pr-3 font-medium">Username</th>
                  <th className="pb-2 pr-3 font-medium">Result</th>
                  <th className="pb-2 pr-3 font-medium">Detail</th>
                  {!result.dryRun && <th className="pb-2 font-medium">Temporary password</th>}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={`${row.line}-${row.username}`} className="border-t border-[var(--color-border-subtle)]">
                    <td className="py-1.5 pr-3 text-xs text-[var(--color-content-muted)]">{row.line}</td>
                    <td className="py-1.5 pr-3 font-mono text-xs">{row.username || '—'}</td>
                    <td
                      className={cx(
                        'py-1.5 pr-3 text-xs',
                        row.status === 'created' && 'text-[var(--color-tlp-green)]',
                        row.status === 'skipped' && 'text-[var(--color-severity-medium)]',
                        row.status === 'error' && 'text-[var(--color-severity-critical)]',
                      )}
                    >
                      {row.status}
                    </td>
                    <td className="py-1.5 pr-3 text-xs text-[var(--color-content-muted)]">
                      {row.message ?? row.email ?? ''}
                    </td>
                    {!result.dryRun && (
                      <td className="py-1.5 font-mono text-xs">{row.temporaryPassword ?? ''}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
