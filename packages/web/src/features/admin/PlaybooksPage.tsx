import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { Alert, Badge, Button, Card, Field, Input, cx } from '@/components/ui';
import { TagPicker } from '@/components/TagPicker';
import type { CategoryRow } from './types';

const controlClass =
  'w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]';

interface PlaybookItem {
  id?: string;
  title: string;
  prompt: string;
}

interface Playbook {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  isActive: boolean;
  matchTags: string[];
  matchCategories: string[];
  sortOrder: number;
  items: PlaybookItem[];
}

const BLANK: Playbook = {
  id: '',
  name: '',
  description: '',
  isDefault: false,
  isActive: true,
  matchTags: [],
  matchCategories: [],
  sortOrder: 100,
  items: [{ title: '', prompt: '' }],
};

/**
 * Playbook editor.
 *
 * The questions a case opens with are the difference between a useful write-up
 * and "handled", and they are exactly the thing a SOC lead wants to change
 * after a few weeks of using them — so they live here rather than in code.
 */
export function PlaybooksPage() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Playbook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const playbooks = useQuery({
    queryKey: ['admin-playbooks'],
    queryFn: () => api.get<{ items: Playbook[] }>('/admin/task-templates'),
  });

  const categories = useQuery({
    queryKey: ['admin-categories'],
    queryFn: () => api.get<{ items: CategoryRow[] }>('/admin/categories'),
  });

  function fail(caught: unknown) {
    setNotice(null);
    setError(caught instanceof ApiError ? caught.detail : 'Could not reach the server.');
  }

  const save = useMutation({
    mutationFn: (playbook: Playbook) =>
      api.post('/admin/task-templates', {
        ...(playbook.id ? { id: playbook.id } : {}),
        name: playbook.name,
        description: playbook.description,
        isDefault: playbook.isDefault,
        isActive: playbook.isActive,
        matchTags: playbook.matchTags,
        matchCategories: playbook.matchCategories,
        sortOrder: playbook.sortOrder,
        items: playbook.items.filter((item) => item.title.trim()),
      }),
    onSuccess: () => {
      setError(null);
      setNotice('Playbook saved. It applies to cases opened from now on.');
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-playbooks'] });
      void queryClient.invalidateQueries({ queryKey: ['playbooks'] });
    },
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/task-templates/${id}`),
    onSuccess: () => {
      setError(null);
      setNotice('Playbook deleted. Tasks it already created stay on their cases.');
      void queryClient.invalidateQueries({ queryKey: ['admin-playbooks'] });
    },
    onError: fail,
  });

  return (
    <div className="max-w-4xl space-y-4 p-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Playbooks</h1>
          <p className="mt-1 text-sm text-[var(--color-content-muted)]">
            The checklist a case starts with. Which one applies is decided by the case's tags and
            category, so phishing and EDR cases ask different questions.
          </p>
        </div>
        {!draft && <Button onClick={() => setDraft({ ...BLANK })}>New playbook</Button>}
      </header>

      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {draft && (
        <Card title={draft.id ? `Edit “${draft.name}”` : 'New playbook'}>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name">
                <Input
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder="Phishing response"
                />
              </Field>
              <Field label="Description">
                <Input
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                />
              </Field>
            </div>

            <Field
              label="Applies to tags"
              hint="Any overlap with the case's tags triggers this playbook"
            >
              <TagPicker
                value={draft.matchTags}
                onChange={(matchTags) => setDraft({ ...draft, matchTags })}
                disabled={draft.isDefault}
              />
            </Field>

            <Field label="Applies to categories">
              <select
                multiple
                value={draft.matchCategories}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    matchCategories: [...event.target.selectedOptions].map((option) => option.value),
                  })
                }
                disabled={draft.isDefault}
                className={cx(controlClass, 'h-28')}
              >
                {categories.data?.items.map((category) => (
                  <option key={category.id} value={category.slug}>
                    {category.name}
                  </option>
                ))}
              </select>
            </Field>

            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.isDefault}
                  onChange={(event) => setDraft({ ...draft, isDefault: event.target.checked })}
                />
                Apply to every case
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })}
                />
                Active
              </label>
            </div>

            <div>
              <p className="mb-2 text-xs tracking-wide text-[var(--color-content-muted)] uppercase">
                Questions ({draft.items.length})
              </p>
              <div className="space-y-2">
                {draft.items.map((item, index) => (
                  <div key={index} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
                    <Input
                      value={item.title}
                      onChange={(event) => {
                        const items = [...draft.items];
                        items[index] = { ...item, title: event.target.value };
                        setDraft({ ...draft, items });
                      }}
                      placeholder="Task title, e.g. Affected Host"
                    />
                    <Input
                      value={item.prompt}
                      onChange={(event) => {
                        const items = [...draft.items];
                        items[index] = { ...item, prompt: event.target.value };
                        setDraft({ ...draft, items });
                      }}
                      placeholder="The question the analyst answers"
                    />
                    <button
                      onClick={() =>
                        setDraft({ ...draft, items: draft.items.filter((_, i) => i !== index) })
                      }
                      className="rounded border border-[var(--color-border-subtle)] px-2 text-xs text-[var(--color-content-muted)] hover:text-[var(--color-severity-critical)]"
                    >
                      remove
                    </button>
                  </div>
                ))}
              </div>
              <Button
                variant="secondary"
                className="mt-2 px-3 py-1 text-xs"
                onClick={() => setDraft({ ...draft, items: [...draft.items, { title: '', prompt: '' }] })}
              >
                Add question
              </Button>
            </div>

            <div className="flex gap-2 border-t border-[var(--color-border-subtle)] pt-4">
              <Button
                loading={save.isPending}
                disabled={!draft.name.trim() || draft.items.every((item) => !item.title.trim())}
                onClick={() => save.mutate(draft)}
              >
                Save playbook
              </Button>
              <Button variant="secondary" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      {playbooks.data?.items.map((playbook) => (
        <Card key={playbook.id}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-medium">{playbook.name}</h2>
                {playbook.isDefault && <Badge tone="good">every case</Badge>}
                {!playbook.isActive && <Badge tone="warn">inactive</Badge>}
              </div>
              <p className="mt-1 text-sm text-[var(--color-content-muted)]">{playbook.description}</p>
              <p className="mt-1 text-xs text-[var(--color-content-muted)]">
                {playbook.isDefault
                  ? 'Applied to every case regardless of tags.'
                  : `Tags: ${playbook.matchTags.join(', ') || '—'} · Categories: ${
                      playbook.matchCategories.join(', ') || '—'
                    }`}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="px-2 py-1 text-xs"
                onClick={() => setDraft({ ...playbook })}
              >
                Edit
              </Button>
              <Button
                variant="danger"
                className="px-2 py-1 text-xs"
                onClick={() => remove.mutate(playbook.id)}
              >
                Delete
              </Button>
            </div>
          </div>

          <ol className="mt-3 space-y-1.5 border-t border-[var(--color-border-subtle)] pt-3">
            {playbook.items.map((item) => (
              <li key={item.id ?? item.title} className="text-sm">
                <span className="font-medium">{item.title}</span>
                {item.prompt && (
                  <span className="block text-xs text-[var(--color-content-muted)]">{item.prompt}</span>
                )}
              </li>
            ))}
          </ol>
        </Card>
      ))}
    </div>
  );
}
