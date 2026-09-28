import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Severity, Tlp } from '@black-ticket/shared';
import { api, ApiError } from '@/lib/api';
import { Alert, Button, Card, Field, Input } from '@/components/ui';
import { formatDateTime } from '@/components/case-bits';
import { MitrePicker } from './MitrePicker';
import { TagPicker } from '@/components/TagPicker';
import type { CaseRecord, PersonRef } from './types';

const controlClass =
  'w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]';

interface Props {
  record: CaseRecord;
  canEdit: boolean;
  canAssignAnyone: boolean;
  people: PersonRef[];
  onAssign: (userId: string | null) => void;
  onSaved: () => void;
}

export function CaseOverviewTab({ record, canEdit, canAssignAnyone, people, onAssign, onSaved }: Props) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: record.title,
    description: record.description,
    severity: record.severity,
    tlp: record.tlp,
    pap: record.pap,
  });
  const [tags, setTags] = useState<string[]>(record.tags);
  const [mitre, setMitre] = useState<string[]>(record.mitre.map((entry) => entry.id));

  const save = useMutation({
    mutationFn: async () => {
      await api.patch(`/cases/${record.id}`, {
        title: form.title,
        description: form.description,
        severity: form.severity,
        tlp: form.tlp,
        pap: form.pap,
        tags,
      });
      await api.post(`/cases/${record.id}/mitre`, { techniqueIds: mitre });
    },
    onSuccess: () => {
      setError(null);
      setEditing(false);
      onSaved();
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.detail : 'Could not reach the server.'),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {error && <Alert>{error}</Alert>}

        {!editing ? (
          <Card title="Description">
            <p className="text-sm whitespace-pre-wrap">
              {record.description || (
                <span className="text-[var(--color-content-muted)]">No description yet.</span>
              )}
            </p>
            {canEdit && (
              <Button variant="secondary" className="mt-4" onClick={() => setEditing(true)}>
                Edit case
              </Button>
            )}
          </Card>
        ) : (
          <Card title="Edit case">
            <div className="space-y-4">
              <Field label="Title">
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </Field>

              <Field label="Description">
                <textarea
                  rows={8}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className={controlClass}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Severity" hint="Changing this re-derives the SLA">
                  <select
                    value={form.severity}
                    onChange={(e) => setForm({ ...form, severity: e.target.value as Severity })}
                    className={controlClass}
                  >
                    {Object.values(Severity).map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="TLP">
                  <select
                    value={form.tlp}
                    onChange={(e) => setForm({ ...form, tlp: e.target.value as Tlp })}
                    className={controlClass}
                  >
                    {Object.values(Tlp).map((value) => (
                      <option key={value} value={value}>
                        TLP:{value}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="PAP">
                  <select
                    value={form.pap}
                    onChange={(e) => setForm({ ...form, pap: e.target.value as Tlp })}
                    className={controlClass}
                  >
                    {Object.values(Tlp).map((value) => (
                      <option key={value} value={value}>
                        PAP:{value}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field
                label="Tags"
                hint="Changing tags does not remove tasks; apply the matching playbook from the Tasks tab"
              >
                <TagPicker value={tags} onChange={setTags} />
              </Field>

              <div>
                <p className="mb-2 text-xs font-medium tracking-wide text-[var(--color-content-muted)] uppercase">
                  MITRE ATT&CK
                </p>
                <MitrePicker selected={mitre} onChange={setMitre} />
              </div>

              <div className="flex gap-2">
                <Button loading={save.isPending} onClick={() => save.mutate()}>
                  Save
                </Button>
                <Button variant="secondary" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </Card>
        )}

        {!editing && record.mitre.length > 0 && (
          <Card title="MITRE ATT&CK">
            <ul className="space-y-1 text-sm">
              {record.mitre.map((technique) => (
                <li key={technique.id} className="flex items-baseline gap-2">
                  <span className="w-24 shrink-0 font-mono text-xs">{technique.id}</span>
                  <span className="flex-1">{technique.name}</span>
                  <span className="text-xs text-[var(--color-content-muted)]">{technique.tactic}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <div className="space-y-4">
        <Card title="Details">
          <dl className="space-y-2 text-sm">
            <Row label="Assignee">
              {canAssignAnyone ? (
                <select
                  value={record.assignee?.id ?? ''}
                  onChange={(event) => onAssign(event.target.value || null)}
                  className="w-40 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1 text-xs outline-none"
                >
                  <option value="">Unassigned</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.fullName}
                    </option>
                  ))}
                </select>
              ) : (
                (record.assignee?.fullName ?? 'unassigned')
              )}
            </Row>
            <Row label="Reporter">{record.reporter.fullName}</Row>
            <Row label="Source">{record.sourceSystem}</Row>
            <Row label="Incident time">{formatDateTime(record.occurredAt)}</Row>
            <Row label="First response">{formatDateTime(record.firstResponseAt)}</Row>
            <Row label="Response due">{formatDateTime(record.slaFirstResponseDueAt)}</Row>
            <Row label="Resolution due">{formatDateTime(record.slaDueAt)}</Row>
            <Row label="Opened">{formatDateTime(record.createdAt)}</Row>
            <Row label="Last change">{formatDateTime(record.updatedAt)}</Row>
            <Row label="Observables">{record.observableCount}</Row>
          </dl>
        </Card>

        {record.tags.length > 0 && (
          <Card title="Tags">
            <div className="flex flex-wrap gap-1.5">
              {record.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded border border-[var(--color-border-subtle)] px-2 py-0.5 text-xs text-[var(--color-content-muted)]"
                >
                  #{tag}
                </span>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[var(--color-content-muted)]">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
