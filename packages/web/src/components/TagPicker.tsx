import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cx } from '@/components/ui';

export interface TagOption {
  name: string;
  description: string | null;
  color: string;
  isSuggested: boolean;
  usageCount: number;
}

interface TagPickerProps {
  value: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}

/** Tags are stored lower-case with dashes so the vocabulary stays consistent. */
function normalise(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9._-]/g, '');
}

/**
 * Tag input with suggestions.
 *
 * The catalogue is offered in a dropdown so the team converges on one word for
 * one thing, but anything can still be typed — an analyst must never be unable
 * to file a case because the vocabulary is missing a term. New tags are
 * registered server-side, so today's free text becomes tomorrow's suggestion.
 */
export function TagPicker({ value, onChange, disabled, placeholder }: TagPickerProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const container = useRef<HTMLDivElement>(null);

  const catalogue = useQuery({
    queryKey: ['tags'],
    queryFn: () => api.get<{ items: TagOption[] }>('/tags'),
    staleTime: 5 * 60_000,
  });

  const suggestions = useMemo(() => {
    const term = normalise(query);
    return (catalogue.data?.items ?? [])
      .filter((tag) => !value.includes(tag.name))
      .filter((tag) => (term ? tag.name.includes(term) : true))
      .slice(0, 8);
  }, [catalogue.data, query, value]);

  // A new query means a new suggestion list, so the highlight goes back to the
  // top. Adjusted during render so the first paint of the new list already has
  // the right row highlighted.
  const [highlightedFor, setHighlightedFor] = useState(query);
  if (highlightedFor !== query) {
    setHighlightedFor(query);
    setHighlight(0);
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  function add(tag: string) {
    const clean = normalise(tag);
    if (!clean || value.includes(clean)) {
      setQuery('');
      return;
    }
    onChange([...value, clean]);
    setQuery('');
  }

  const exactExists = suggestions.some((tag) => tag.name === normalise(query));
  const canCreate = normalise(query).length > 1 && !exactExists && !value.includes(normalise(query));

  return (
    <div className="relative" ref={container}>
      <div
        className={cx(
          'flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5',
          'border-[var(--color-border-subtle)] bg-[var(--color-surface)]',
          'focus-within:border-[var(--color-accent)]',
          disabled && 'opacity-50',
        )}
      >
        {value.map((tag) => {
          const known = catalogue.data?.items.find((entry) => entry.name === tag);
          return (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs"
              style={{ borderColor: known?.color ?? 'var(--color-border-subtle)', color: known?.color ?? undefined }}
            >
              {tag}
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Remove ${tag}`}
                  onClick={() => onChange(value.filter((entry) => entry !== tag))}
                  className="text-[var(--color-content-muted)] hover:text-[var(--color-severity-critical)]"
                >
                  ×
                </button>
              )}
            </span>
          );
        })}

        <input
          value={query}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault();
              const chosen = suggestions[highlight];
              add(chosen && !canCreate ? chosen.name : query);
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              setHighlight((index) => Math.min(index + 1, suggestions.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setHighlight((index) => Math.max(index - 1, 0));
            } else if (event.key === 'Backspace' && !query && value.length > 0) {
              onChange(value.slice(0, -1));
            } else if (event.key === 'Escape') {
              setOpen(false);
            }
          }}
          placeholder={value.length === 0 ? (placeholder ?? 'Pick or type a tag…') : ''}
          className="min-w-32 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--color-content-muted)]"
        />
      </div>

      {open && !disabled && (suggestions.length > 0 || canCreate) && (
        <div className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] shadow-lg">
          {suggestions.map((tag, index) => (
            <button
              key={tag.name}
              type="button"
              onMouseEnter={() => setHighlight(index)}
              onClick={() => add(tag.name)}
              className={cx(
                'flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm',
                index === highlight && !canCreate && 'bg-[var(--color-surface-overlay)]',
                'hover:bg-[var(--color-surface-overlay)]',
              )}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
              <span className="font-medium">{tag.name}</span>
              {tag.description && (
                <span className="flex-1 truncate text-xs text-[var(--color-content-muted)]">
                  {tag.description}
                </span>
              )}
              {tag.usageCount > 0 && (
                <span className="text-[11px] text-[var(--color-content-muted)]">
                  {tag.usageCount}×
                </span>
              )}
            </button>
          ))}

          {canCreate && (
            <button
              type="button"
              onClick={() => add(query)}
              className="flex w-full items-center gap-2 border-t border-[var(--color-border-subtle)] px-3 py-1.5 text-left text-sm hover:bg-[var(--color-surface-overlay)]"
            >
              <span className="text-[var(--color-accent)]">+</span>
              Add “{normalise(query)}” as a new tag
            </button>
          )}
        </div>
      )}
    </div>
  );
}
