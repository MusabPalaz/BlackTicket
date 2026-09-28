import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TaskStatus } from '@black-ticket/shared';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { Button, Card, EmptyState, Input, Select, Skeleton, Textarea, cx } from '@/components/ui';
import {
  IconCircle,
  IconCircleCheck,
  IconCircleDot,
  IconCircleSlash,
  IconPlaybook,
  IconSend,
} from '@/components/icons';
import { formatDateTime } from '@/components/case-bits';
import type { CaseTask, PersonRef } from './types';

interface Props {
  caseId: string;
  readOnly: boolean;
  people: PersonRef[];
  onChanged: () => void;
}

interface Playbook {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  matchTags: string[];
  items: { id: string; title: string; prompt: string }[];
}

/**
 * Status markers.
 *
 * A completed task used to be struck through, which reads as "cancelled, do
 * not bother" — precisely the wrong signal for the answer an analyst just
 * wrote. A marker states the state without defacing the text.
 */
const STATUS_MARKER: Record<TaskStatus, { icon: typeof IconCircle; className: string; label: string }> = {
  TODO: { icon: IconCircle, className: 'text-[var(--color-content-faint)]', label: 'Not started' },
  IN_PROGRESS: { icon: IconCircleDot, className: 'text-[var(--color-accent)]', label: 'In progress' },
  DONE: { icon: IconCircleCheck, className: 'text-[var(--color-tlp-green)]', label: 'Done' },
  CANCELLED: { icon: IconCircleSlash, className: 'text-[var(--color-content-faint)]', label: 'Not applicable' },
};

export function CaseTasksTab({ caseId, readOnly, people, onChanged }: Props) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [newTask, setNewTask] = useState({ title: '', assigneeId: '' });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [playbookId, setPlaybookId] = useState('');
  const [addingTask, setAddingTask] = useState(false);

  const tasks = useQuery({
    queryKey: ['case-tasks', caseId],
    queryFn: () => api.get<{ items: CaseTask[] }>(`/cases/${caseId}/tasks`),
  });

  const playbooks = useQuery({
    queryKey: ['playbooks'],
    queryFn: () => api.get<{ items: Playbook[] }>('/task-templates'),
    staleTime: 5 * 60_000,
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['case-tasks', caseId] });
    void queryClient.invalidateQueries({ queryKey: ['case-timeline', caseId] });
    onChanged();
  }

  function fail(caught: unknown) {
    toast.error(caught instanceof ApiError ? caught.detail : 'Could not reach the server.');
  }

  const addAnswer = useMutation({
    mutationFn: ({ taskId, body }: { taskId: string; body: string }) =>
      api.post(`/tasks/${taskId}/logs`, { body }),
    onSuccess: (_result, variables) => {
      setDrafts((current) => ({ ...current, [variables.taskId]: '' }));
      refresh();
    },
    onError: fail,
  });

  const setStatus = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: TaskStatus }) =>
      api.patch(`/tasks/${taskId}`, { status }),
    onSuccess: refresh,
    onError: fail,
  });

  const createTask = useMutation({
    mutationFn: () =>
      api.post<CaseTask>(`/cases/${caseId}/tasks`, {
        title: newTask.title,
        assigneeId: newTask.assigneeId || undefined,
      }),
    onSuccess: () => {
      setNewTask({ title: '', assigneeId: '' });
      setAddingTask(false);
      refresh();
    },
    onError: fail,
  });

  const applyPlaybook = useMutation({
    mutationFn: (id: string) =>
      api.post<{ applied: { templateName: string; created: number }[]; skipped: number }>(
        `/cases/${caseId}/playbooks`,
        id ? { templateIds: [id] } : {},
      ),
    onSuccess: (response) => {
      const added = response.applied.reduce((total, entry) => total + entry.created, 0);
      if (added > 0) {
        toast.success(
          `Added ${added} question(s)`,
          response.applied.map((entry) => entry.templateName).join(', '),
        );
      } else {
        toast.info('Nothing to add', 'Every question from that playbook is already on the case.');
      }
      refresh();
    },
    onError: fail,
  });

  const items = tasks.data?.items ?? [];
  const answered = items.filter((task) => task.answers.length > 0).length;
  const done = items.filter((task) => task.status === TaskStatus.DONE).length;

  return (
    <div className="space-y-4">
      {items.length > 0 && (
        <Card bodyClassName="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-40 flex-1">
              <div className="flex items-baseline justify-between text-sm">
                <span>
                  <span className="font-medium tabular-nums">{answered}</span>
                  <span className="text-[var(--color-content-muted)]"> of {items.length} answered</span>
                </span>
                <span className="text-xs text-[var(--color-content-muted)] tabular-nums">{done} done</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-overlay)]">
                <div
                  className="h-full rounded-full bg-[var(--color-tlp-green)] transition-all duration-300"
                  style={{ width: `${items.length ? (answered / items.length) * 100 : 0}%` }}
                />
              </div>
            </div>

            {!readOnly && (
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={playbookId}
                  onChange={(event) => setPlaybookId(event.target.value)}
                  className="w-auto"
                  aria-label="Playbook to add"
                >
                  <option value="">Matching playbook</option>
                  {playbooks.data?.items.map((playbook) => (
                    <option key={playbook.id} value={playbook.id}>
                      {playbook.name} ({playbook.items.length})
                    </option>
                  ))}
                </Select>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<IconPlaybook className="h-3.5 w-3.5" />}
                  loading={applyPlaybook.isPending}
                  onClick={() => applyPlaybook.mutate(playbookId)}
                >
                  Add questions
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setAddingTask((open) => !open)}>
                  {addingTask ? 'Cancel' : 'New task'}
                </Button>
              </div>
            )}
          </div>
        </Card>
      )}

      {addingTask && !readOnly && (
        <Card bodyClassName="p-4">
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
            <Input
              value={newTask.title}
              onChange={(event) => setNewTask({ ...newTask, title: event.target.value })}
              placeholder="What needs doing or answering?"
              autoFocus
              onKeyDown={(event) => {
                if (event.key === 'Enter' && newTask.title.trim()) createTask.mutate();
              }}
            />
            <Select
              value={newTask.assigneeId}
              onChange={(event) => setNewTask({ ...newTask, assigneeId: event.target.value })}
              aria-label="Assign the task"
            >
              <option value="">Nobody in particular</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </Select>
            <Button loading={createTask.isPending} disabled={!newTask.title.trim()} onClick={() => createTask.mutate()}>
              Add
            </Button>
          </div>
        </Card>
      )}

      {tasks.isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-20" />
          ))}
        </div>
      )}

      {!tasks.isLoading && items.length === 0 && (
        <Card>
          <EmptyState
            icon={<IconPlaybook className="h-8 w-8" />}
            title="No questions on this case yet"
            description="A case normally opens with the checklist that matches its tags. Add one, or write your own task."
            action={
              !readOnly && (
                <div className="flex gap-2">
                  <Button loading={applyPlaybook.isPending} onClick={() => applyPlaybook.mutate('')}>
                    Add matching playbook
                  </Button>
                  <Button variant="secondary" onClick={() => setAddingTask(true)}>
                    New task
                  </Button>
                </div>
              )
            }
          />
        </Card>
      )}

      <div className="space-y-2.5">
        {items.map((task) => {
          const marker = STATUS_MARKER[task.status];
          const Marker = marker.icon;
          const draft = drafts[task.id] ?? '';
          const isClosedOut = task.status === TaskStatus.DONE || task.status === TaskStatus.CANCELLED;

          return (
            <Card key={task.id} bodyClassName="p-4">
              <div className="flex gap-3">
                <button
                  type="button"
                  disabled={readOnly}
                  title={readOnly ? marker.label : `${marker.label} — click to ${task.status === TaskStatus.DONE ? 'reopen' : 'mark done'}`}
                  aria-label={`${task.title}: ${marker.label}`}
                  onClick={() =>
                    setStatus.mutate({
                      taskId: task.id,
                      status: task.status === TaskStatus.DONE ? TaskStatus.TODO : TaskStatus.DONE,
                    })
                  }
                  className={cx(
                    'mt-0.5 shrink-0 transition-colors disabled:cursor-default',
                    marker.className,
                    !readOnly && task.status !== TaskStatus.DONE && 'hover:text-[var(--color-tlp-green)]',
                  )}
                >
                  <Marker className="h-5 w-5" />
                </button>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p
                      className={cx(
                        'text-sm font-medium',
                        // Completed work is dimmed, never struck through: the
                        // answer under it is still the record of what happened.
                        isClosedOut && 'text-[var(--color-content-muted)]',
                      )}
                    >
                      {task.title}
                    </p>

                    <div className="flex shrink-0 items-center gap-2">
                      {task.templateItemId && (
                        <span className="rounded border border-[var(--color-border-subtle)] px-1.5 py-0.5 text-[10px] tracking-wide text-[var(--color-content-faint)] uppercase">
                          playbook
                        </span>
                      )}
                      {!readOnly && (
                        <Select
                          value={task.status}
                          onChange={(event) =>
                            setStatus.mutate({ taskId: task.id, status: event.target.value as TaskStatus })
                          }
                          aria-label={`Status of ${task.title}`}
                          className="w-auto py-1 text-xs"
                        >
                          {Object.values(TaskStatus).map((status) => (
                            <option key={status} value={status}>
                              {STATUS_MARKER[status].label}
                            </option>
                          ))}
                        </Select>
                      )}
                    </div>
                  </div>

                  {task.description && (
                    <p className="mt-1 text-sm whitespace-pre-wrap text-[var(--color-content-muted)]">
                      {task.description}
                    </p>
                  )}

                  {task.answers.length > 0 && (
                    <ul className="mt-3 space-y-2.5 border-l-2 border-[var(--color-border-subtle)] pl-3">
                      {task.answers.map((answer) => (
                        <li key={answer.id}>
                          <p className="text-sm whitespace-pre-wrap">{answer.body}</p>
                          <p className="mt-0.5 text-[11px] text-[var(--color-content-faint)]">
                            {answer.author.fullName} · {formatDateTime(answer.createdAt)}
                          </p>
                        </li>
                      ))}
                      {task.logCount > task.answers.length && (
                        <li className="text-[11px] text-[var(--color-content-faint)]">
                          {task.logCount - task.answers.length} earlier answer(s) not shown
                        </li>
                      )}
                    </ul>
                  )}

                  {!readOnly && (
                    <div className="mt-3">
                      <Textarea
                        rows={draft ? 3 : 1}
                        value={draft}
                        onChange={(event) => setDrafts({ ...drafts, [task.id]: event.target.value })}
                        onKeyDown={(event) => {
                          // Ctrl/Cmd+Enter submits: the answer field is a
                          // textarea because answers run to a paragraph, and a
                          // bare Enter has to keep making new lines.
                          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && draft.trim()) {
                            addAnswer.mutate({ taskId: task.id, body: draft });
                          }
                        }}
                        placeholder={
                          task.answers.length > 0 ? 'Add another answer…' : 'Answer this question…'
                        }
                        className="text-sm"
                      />
                      {draft.trim() && (
                        <div className="animate-in mt-2 flex items-center gap-2">
                          <Button
                            size="sm"
                            icon={<IconSend className="h-3.5 w-3.5" />}
                            loading={addAnswer.isPending}
                            onClick={() => addAnswer.mutate({ taskId: task.id, body: draft })}
                          >
                            Add
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDrafts({ ...drafts, [task.id]: '' })}
                          >
                            Discard
                          </Button>
                          <span className="text-[11px] text-[var(--color-content-faint)]">
                            Answers cannot be edited afterwards — they are the record.
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  <p className="mt-2 text-[11px] text-[var(--color-content-faint)]">
                    {task.assignee ? task.assignee.fullName : 'unassigned'}
                    {task.completedAt && ` · done ${formatDateTime(task.completedAt)}`}
                  </p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
