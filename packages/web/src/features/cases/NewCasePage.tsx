import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Severity, Tlp } from '@black-ticket/shared';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { Alert, Button, Card, Field, Input, cx } from '@/components/ui';
import { MitrePicker } from './MitrePicker';
import { TagPicker } from '@/components/TagPicker';
import type { CaseRecord, CategoryRef, PersonRef } from './types';

const selectClass =
  'w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]';

/** Opening a case should take well under a minute — only the title is required. */
export function NewCasePage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '',
    description: '',
    severity: Severity.MEDIUM as Severity,
    tlp: Tlp.AMBER as Tlp,
    pap: Tlp.AMBER as Tlp,
    categoryId: '',
    assigneeId: '',
    occurredAt: '',
  });
  const [tags, setTags] = useState<string[]>([]);
  const [mitre, setMitre] = useState<string[]>([]);

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<{ items: CategoryRef[] }>('/categories'),
    staleTime: 5 * 60_000,
  });

  const people = useQuery({
    queryKey: ['assignable'],
    queryFn: () => api.get<{ items: PersonRef[] }>('/users/assignable'),
    staleTime: 5 * 60_000,
  });

  // Taking the case yourself is the common move, and hunting for your own name
  // in a list of everyone is not. Read-only accounts never appear in the list,
  // so this is also the check for whether you are allowed to own a case at all.
  const me = people.data?.items.find((person) => person.id === user?.id);

  const create = useMutation({
    mutationFn: () =>
      api.post<CaseRecord>('/cases', {
        title: form.title,
        description: form.description || undefined,
        severity: form.severity,
        tlp: form.tlp,
        pap: form.pap,
        categoryId: form.categoryId || undefined,
        assigneeId: form.assigneeId || undefined,
        occurredAt: form.occurredAt ? new Date(form.occurredAt).toISOString() : undefined,
        tags,
        mitre: mitre.length ? mitre : undefined,
      }),
    onSuccess: (created) => navigate(`/cases/${created.id}`),
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.detail : 'Could not reach the server.'),
  });

  return (
    <div className="max-w-3xl space-y-4 p-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">New case</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          Only a title is required; everything else can be filled in while you work.
        </p>
      </header>

      {error && <Alert>{error}</Alert>}

      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          setError(null);
          create.mutate();
        }}
        className="space-y-4"
      >
        <Card>
          <div className="space-y-4">
            <Field label="Title">
              <Input
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
                placeholder="Phishing campaign targeting finance"
                autoFocus
                required
              />
            </Field>

            <Field
              label="Description"
              hint="What was seen, where, and by whom. Line breaks are kept."
            >
              <textarea
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                rows={6}
                className={selectClass}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Severity">
                <select
                  value={form.severity}
                  onChange={(event) =>
                    setForm({ ...form, severity: event.target.value as Severity })
                  }
                  className={selectClass}
                >
                  {Object.values(Severity).map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="TLP" hint="How far this may be shared">
                <select
                  value={form.tlp}
                  onChange={(event) => setForm({ ...form, tlp: event.target.value as Tlp })}
                  className={selectClass}
                >
                  {Object.values(Tlp).map((value) => (
                    <option key={value} value={value}>
                      TLP:{value}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="PAP" hint="How aggressively indicators may be probed">
                <select
                  value={form.pap}
                  onChange={(event) => setForm({ ...form, pap: event.target.value as Tlp })}
                  className={selectClass}
                >
                  {Object.values(Tlp).map((value) => (
                    <option key={value} value={value}>
                      PAP:{value}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Category">
                <select
                  value={form.categoryId}
                  onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
                  className={selectClass}
                >
                  <option value="">None</option>
                  {categories.data?.items.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Assign to">
                <div className="flex gap-2">
                  <select
                    value={form.assigneeId}
                    onChange={(event) => setForm({ ...form, assigneeId: event.target.value })}
                    className={cx(selectClass, 'min-w-0 flex-1')}
                  >
                    <option value="">Leave in the queue</option>
                    {people.data?.items.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.fullName}
                        {person.id === user?.id ? ' (you)' : ''} ({person.role ?? ''})
                      </option>
                    ))}
                  </select>

                  {me && form.assigneeId !== me.id && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="shrink-0"
                      onClick={() => setForm({ ...form, assigneeId: me.id })}
                    >
                      Assign to me
                    </Button>
                  )}
                </div>
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Incident time" hint="Defaults to now; the SLA clock starts here">
                <Input
                  type="datetime-local"
                  value={form.occurredAt}
                  onChange={(event) => setForm({ ...form, occurredAt: event.target.value })}
                />
              </Field>

              <Field
                label="Tags"
                hint="Tags decide which checklist the case starts with — pick from the list or type your own"
              >
                <TagPicker value={tags} onChange={setTags} placeholder="phishing, edr, insider…" />
              </Field>
            </div>
          </div>
        </Card>

        <Card title="MITRE ATT&CK">
          <MitrePicker selected={mitre} onChange={setMitre} />
        </Card>

        <div className="flex gap-2">
          <Button type="submit" loading={create.isPending}>
            Open case
          </Button>
          <Button type="button" variant="secondary" onClick={() => navigate('/cases')}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
