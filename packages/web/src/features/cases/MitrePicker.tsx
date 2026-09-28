import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Input, cx } from '@/components/ui';
import type { MitreRef } from './types';

interface MitrePickerProps {
  selected: string[];
  onChange: (techniqueIds: string[]) => void;
  disabled?: boolean;
}

/**
 * Technique search over the bundled ATT&CK subset.
 *
 * The chosen ids are kept as plain strings rather than objects so the picker
 * can be used both when creating a case and when editing one.
 */
export function MitrePicker({ selected, onChange, disabled }: MitrePickerProps) {
  const [term, setTerm] = useState('');

  const techniques = useQuery({
    queryKey: ['mitre', term],
    queryFn: () => api.get<{ items: MitreRef[] }>(`/mitre/techniques?q=${encodeURIComponent(term)}`),
    staleTime: 5 * 60_000,
  });

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);
  }

  return (
    <div className="space-y-3">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((id) => (
            <button
              key={id}
              type="button"
              disabled={disabled}
              onClick={() => toggle(id)}
              title="Remove"
              className="rounded border border-[var(--color-accent)] px-2 py-0.5 font-mono text-xs text-[var(--color-accent)] hover:line-through disabled:opacity-50"
            >
              {id}
            </button>
          ))}
        </div>
      )}

      <Input
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder="Search technique id, name or tactic…"
        disabled={disabled}
      />

      <div className="max-h-56 overflow-y-auto rounded-md border border-[var(--color-border-subtle)]">
        {techniques.data?.items.map((technique) => {
          const isSelected = selected.includes(technique.id);
          return (
            <button
              key={technique.id}
              type="button"
              disabled={disabled}
              onClick={() => toggle(technique.id)}
              className={cx(
                'flex w-full items-baseline gap-2 border-b border-[var(--color-border-subtle)] px-3 py-1.5 text-left text-sm last:border-b-0',
                'hover:bg-[var(--color-surface-overlay)] disabled:opacity-50',
                isSelected && 'bg-[var(--color-surface-overlay)]',
              )}
            >
              <span className="w-24 shrink-0 font-mono text-xs">{technique.id}</span>
              <span className="flex-1">{technique.name}</span>
              <span className="text-xs text-[var(--color-content-muted)]">{technique.tactic}</span>
              {isSelected && <span className="text-xs text-[var(--color-accent)]">selected</span>}
            </button>
          );
        })}
        {techniques.data?.items.length === 0 && (
          <p className="px-3 py-3 text-sm text-[var(--color-content-muted)]">No matching technique.</p>
        )}
      </div>
    </div>
  );
}
