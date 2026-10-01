import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ObservableType,
  Tlp,
  detectObservableType,
  extractObservables,
} from '@black-ticket/shared';
import { api, ApiError } from '@/lib/api';
import { Alert, Button, Card, Input, cx } from '@/components/ui';
import { formatDateTime } from '@/components/case-bits';
import { useConfirm } from '@/components/ConfirmDialog';
import type { AddObservablesResult, CaseObservable } from './types';

const controlClass =
  'rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1.5 text-sm outline-none focus:border-[var(--color-accent)]';

interface Props {
  caseId: string;
  readOnly: boolean;
  onChanged: () => void;
}

interface Draft {
  type: ObservableType;
  value: string;
  isIoc: boolean;
}

/**
 * One worked example per indicator type, shown as the value field's
 * placeholder so the hint matches whatever the type selector is set to.
 *
 * Everything that can be defanged is: an analyst copying a placeholder into a
 * ticket, a chat or a browser should never end up with a live address, and the
 * field accepts both forms anyway. The hashes are the well-known digests of the
 * empty string, which no one will mistake for real evidence.
 */
const EXAMPLE_VALUE: Record<ObservableType, string> = {
  [ObservableType.IP]: '185.220.101[.]4',
  [ObservableType.DOMAIN]: 'secure-login[.]example[.]com',
  [ObservableType.URL]: 'hxxps://secure-login[.]example[.]com/verify',
  [ObservableType.HASH_MD5]: 'd41d8cd98f00b204e9800998ecf8427e',
  [ObservableType.HASH_SHA1]: 'da39a3ee5e6b4b0d3255bfef95601890afd80709',
  [ObservableType.HASH_SHA256]: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  [ObservableType.EMAIL]: 'billing@invoice-support[.]com',
  [ObservableType.USERNAME]: 'svc_backup',
  [ObservableType.HOSTNAME]: 'WIN-FIN-014',
  [ObservableType.FILENAME]: 'invoice_2026-08.xlsm',
  [ObservableType.REGISTRY_KEY]: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\Updater',
  [ObservableType.MUTEX]: 'Global\\mtx_7f3a91',
  [ObservableType.USER_AGENT]: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  [ObservableType.OTHER]: 'Anything the other types do not cover',
};

export function CaseObservablesTab({ caseId, readOnly, onChanged }: Props) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AddObservablesResult | null>(null);
  const [paste, setPaste] = useState('');
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [single, setSingle] = useState<Draft>({ type: ObservableType.IP, value: '', isIoc: true });

  const observables = useQuery({
    queryKey: ['case-observables', caseId],
    queryFn: () => api.get<{ items: CaseObservable[] }>(`/cases/${caseId}/observables`),
  });

  /**
   * Parsed in the browser with the same library the API uses, so the preview
   * cannot disagree with what actually gets stored.
   */
  const parsed = useMemo(() => (paste.trim() ? extractObservables(paste) : []), [paste]);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['case-observables', caseId] });
    void queryClient.invalidateQueries({ queryKey: ['case-related', caseId] });
    onChanged();
  }

  const add = useMutation({
    mutationFn: (items: Draft[]) =>
      api.post<AddObservablesResult>(`/cases/${caseId}/observables`, { items }),
    onSuccess: (response) => {
      setError(null);
      setResult(response);
      setPaste('');
      setDrafts(null);
      setSingle({ ...single, value: '' });
      refresh();
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.detail : 'Could not reach the server.'),
  });

  const toggleIoc = useMutation({
    mutationFn: ({ id, isIoc }: { id: string; isIoc: boolean }) =>
      api.patch(`/case-observables/${id}`, { isIoc }),
    onSuccess: refresh,
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.detail : 'Could not reach the server.'),
  });

  const setTlp = useMutation({
    mutationFn: ({ id, tlp }: { id: string; tlp: Tlp }) =>
      api.patch(`/case-observables/${id}`, { tlp }),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/case-observables/${id}`),
    onSuccess: refresh,
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.detail : 'Could not reach the server.'),
  });

  const stagedDrafts =
    drafts ??
    parsed.map((entry) => ({ type: entry.type, value: entry.value, isIoc: true }) satisfies Draft);

  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}

      {result && (
        <Alert tone={result.correlations.length > 0 ? 'warning' : 'success'}>
          Added {result.added.length}
          {result.duplicates.length > 0 && `, ${result.duplicates.length} already present`}
          {result.rejected.length > 0 && `, ${result.rejected.length} rejected`}.
          {result.correlations.length > 0 && (
            <span className="mt-1 block">
              {result.correlations.length} correlation(s):{' '}
              {result.correlations.map((hit) => (
                <Link
                  key={`${hit.caseId}-${hit.observable.id}`}
                  to={`/cases/${hit.caseId}`}
                  className="mr-2 underline"
                >
                  {hit.reference}
                </Link>
              ))}
            </span>
          )}
          {result.rejected.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-xs">
              {result.rejected.map((entry) => (
                <li key={`${entry.type}-${entry.value}`}>
                  {entry.value} — {entry.reason}
                </li>
              ))}
            </ul>
          )}
        </Alert>
      )}

      {!readOnly && (
        <Card title="Add observables">
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-xs tracking-wide text-[var(--color-content-muted)] uppercase">
                Paste anything
              </p>
              <textarea
                rows={4}
                value={paste}
                onChange={(event) => {
                  setPaste(event.target.value);
                  setDrafts(null);
                }}
                placeholder="Paste mail headers, a SIEM row or a chat message — indicators are picked out automatically, defanged or not."
                className={cx(controlClass, 'w-full')}
              />

              {stagedDrafts.length > 0 && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-[var(--color-content-muted)]">
                    {stagedDrafts.length} indicator(s) found:
                  </p>
                  <div className="max-h-56 overflow-y-auto rounded-md border border-[var(--color-border-subtle)]">
                    {stagedDrafts.map((draft, index) => (
                      <div
                        key={`${draft.type}-${draft.value}`}
                        className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-3 py-1.5 text-sm last:border-b-0"
                      >
                        <select
                          value={draft.type}
                          onChange={(event) => {
                            const next = [...stagedDrafts];
                            next[index] = { ...draft, type: event.target.value as ObservableType };
                            setDrafts(next);
                          }}
                          className={cx(controlClass, 'w-40 text-xs')}
                        >
                          {Object.values(ObservableType).map((type) => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))}
                        </select>
                        <span className="flex-1 truncate font-mono text-xs">{draft.value}</span>
                        <label className="flex items-center gap-1 text-xs text-[var(--color-content-muted)]">
                          <input
                            type="checkbox"
                            checked={draft.isIoc}
                            onChange={(event) => {
                              const next = [...stagedDrafts];
                              next[index] = { ...draft, isIoc: event.target.checked };
                              setDrafts(next);
                            }}
                          />
                          IOC
                        </label>
                        <button
                          type="button"
                          onClick={() => setDrafts(stagedDrafts.filter((_, i) => i !== index))}
                          className="text-xs text-[var(--color-content-muted)] hover:text-[var(--color-severity-critical)]"
                        >
                          remove
                        </button>
                      </div>
                    ))}
                  </div>
                  <Button loading={add.isPending} onClick={() => add.mutate(stagedDrafts)}>
                    Add {stagedDrafts.length} observable(s)
                  </Button>
                </div>
              )}
            </div>

            <div className="border-t border-[var(--color-border-subtle)] pt-4">
              <p className="mb-2 text-xs tracking-wide text-[var(--color-content-muted)] uppercase">
                Or add one directly
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={single.type}
                  onChange={(event) =>
                    setSingle({ ...single, type: event.target.value as ObservableType })
                  }
                  className={cx(controlClass, 'w-44')}
                >
                  {Object.values(ObservableType).map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
                <Input
                  value={single.value}
                  onChange={(event) => {
                    const value = event.target.value;
                    // Guess the type as they type, but never override a choice
                    // they made deliberately.
                    const guessed = detectObservableType(value);
                    setSingle((current) => ({
                      ...current,
                      value,
                      type: guessed && !drafts ? guessed : current.type,
                    }));
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && single.value.trim()) add.mutate([single]);
                  }}
                  placeholder={EXAMPLE_VALUE[single.type]}
                  className="min-w-56 flex-1 font-mono"
                />
                <label className="flex items-center gap-1 text-xs text-[var(--color-content-muted)]">
                  <input
                    type="checkbox"
                    checked={single.isIoc}
                    onChange={(event) => setSingle({ ...single, isIoc: event.target.checked })}
                  />
                  IOC
                </label>
                <Button
                  disabled={!single.value.trim()}
                  loading={add.isPending}
                  onClick={() => add.mutate([single])}
                >
                  Add
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      <Card title={`Observables (${observables.data?.items.length ?? 0})`}>
        {observables.data?.items.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--color-content-muted)]">
            No observables yet. Anything added here is matched against every other case.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-[var(--color-content-muted)] uppercase">
                <tr>
                  <th className="pb-2 pr-3 font-medium">Type</th>
                  <th className="pb-2 pr-3 font-medium">Value</th>
                  <th className="pb-2 pr-3 font-medium">IOC</th>
                  <th className="pb-2 pr-3 font-medium">TLP</th>
                  <th className="pb-2 pr-3 font-medium">Seen on</th>
                  <th className="pb-2 pr-3 font-medium">Added</th>
                  <th className="pb-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {observables.data?.items.map((entry) => (
                  <tr key={entry.id} className="border-t border-[var(--color-border-subtle)]">
                    <td className="py-2 pr-3 text-xs whitespace-nowrap">{entry.observable.type}</td>
                    <td className="max-w-md py-2 pr-3">
                      <span className="font-mono text-xs break-all">
                        {entry.observable.normalized}
                      </span>
                      {entry.observable.value !== entry.observable.normalized && (
                        <span className="ml-2 text-xs text-[var(--color-content-muted)]">
                          (as entered: {entry.observable.value})
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="checkbox"
                        checked={entry.isIoc}
                        disabled={readOnly}
                        onChange={(event) =>
                          toggleIoc.mutate({ id: entry.id, isIoc: event.target.checked })
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <select
                        value={entry.tlp}
                        disabled={readOnly}
                        onChange={(event) =>
                          setTlp.mutate({ id: entry.id, tlp: event.target.value as Tlp })
                        }
                        className={cx(controlClass, 'text-xs')}
                      >
                        {Object.values(Tlp).map((tlp) => (
                          <option key={tlp} value={tlp}>
                            {tlp}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pr-3 text-xs whitespace-nowrap">
                      <Link
                        to={`/observables?q=${encodeURIComponent(entry.observable.normalized)}`}
                        className="hover:underline"
                      >
                        {entry.observable.sightingCount} case(s)
                      </Link>
                      {entry.observable.isNoisy && (
                        <span className="ml-2 text-[var(--color-severity-medium)]">noisy</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-xs text-[var(--color-content-muted)] whitespace-nowrap">
                      {entry.addedBy.fullName.split(' ')[0]} ·{' '}
                      {formatDateTime(entry.addedAt).slice(0, 12)}
                    </td>
                    <td className="py-2 text-right">
                      {!readOnly && (
                        <button
                          onClick={async () => {
                            const ok = await confirm({
                              title: 'Remove this indicator from the case?',
                              body: (
                                <>
                                  <p>
                                    <span className="font-mono text-[var(--color-content)]">
                                      {entry.observable.normalized}
                                    </span>{' '}
                                    ({entry.observable.type}) stops counting as seen on this case.
                                  </p>
                                  <p>
                                    The automatic links it made to other cases are removed. The
                                    indicator itself stays in the global search.
                                  </p>
                                </>
                              ),
                              confirmLabel: 'Remove indicator',
                            });
                            if (ok) remove.mutate(entry.id);
                          }}
                          className="text-xs text-[var(--color-content-muted)] hover:text-[var(--color-severity-critical)]"
                        >
                          remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
