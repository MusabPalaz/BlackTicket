import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { ApiError } from '@/lib/api';
import { Alert, Button, Field, Input, Select, Textarea } from './ui';

/** One thing the dialog asks for alongside the decision itself. */
export interface ConfirmField {
  /** Key of the value in the result. */
  name: string;
  label: string;
  kind?: 'text' | 'textarea' | 'password' | 'code' | 'select';
  placeholder?: string;
  hint?: string;
  required?: boolean;
  /** Also holds the confirm button back until it is met. */
  minLength?: number;
  maxLength?: number;
  autoComplete?: string;
  /** For `select`; the first one is chosen unless `defaultValue` says otherwise. */
  options?: { value: string; label: string }[];
  defaultValue?: string;
}

export interface ConfirmOptions {
  title: string;
  /** What happens, in the reader's terms: names, counts, what cannot be undone. */
  body?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Danger for anything that removes, revokes or locks out; primary otherwise. */
  tone?: 'danger' | 'primary';
  /**
   * Must be typed exactly before the action unlocks. Reserved for actions with
   * no way back, where a reflexive click on a highlighted button is the risk.
   */
  typeToConfirm?: string;
  fields?: ConfirmField[];
  /**
   * Runs the action from inside the dialog. While it runs the dialog stays up
   * with its button busy; if it fails, the reason shows in the dialog and what
   * was typed is kept — a mistyped password should not mean starting over.
   * Without it the dialog closes on confirm and the caller acts on the result.
   */
  onConfirm?: (values: Record<string, string>) => Promise<unknown>;
}

/** `false` when cancelled; otherwise what was entered in the fields, by name. */
export type ConfirmResult = false | { values: Record<string, string> };

type Confirm = (options: ConfirmOptions) => Promise<ConfirmResult>;

const ConfirmContext = createContext<Confirm | null>(null);

interface Pending {
  options: ConfirmOptions;
  resolve: (result: ConfirmResult) => void;
}

/**
 * One way of asking "are you sure?" for the whole application.
 *
 * Every action that removes, revokes, locks someone out or cannot be taken back
 * goes through here, so they all look the same, say what will happen, and
 * behave the same for the keyboard: focus starts on the first field or on the
 * safe choice, Escape and the backdrop cancel, Tab stays inside, and focus
 * returns to the button that asked.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback<Confirm>(
    (options) =>
      new Promise<ConfirmResult>((resolve) => {
        setPending((previous) => {
          // A second request supersedes the first rather than stacking dialogs.
          previous?.resolve(false);
          return { options, resolve };
        });
      }),
    [],
  );

  const settle = useCallback((result: ConfirmResult) => {
    setPending((current) => {
      current?.resolve(result);
      return null;
    });
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && <ConfirmDialog options={pending.options} onSettle={settle} />}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): Confirm {
  const context = useContext(ConfirmContext);
  if (!context) throw new Error('useConfirm must be used inside ConfirmProvider');
  return context;
}

function initialValues(fields: ConfirmField[]): Record<string, string> {
  return Object.fromEntries(
    fields.map((field) => [
      field.name,
      field.defaultValue ?? (field.kind === 'select' ? (field.options?.[0]?.value ?? '') : ''),
    ]),
  );
}

/** Passwords go to the server exactly as typed; everything else is trimmed. */
function cleaned(fields: ConfirmField[], values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    fields.map((field) => {
      const raw = values[field.name] ?? '';
      return [field.name, field.kind === 'password' ? raw : raw.trim()];
    }),
  );
}

function satisfied(field: ConfirmField, raw: string): boolean {
  const value = field.kind === 'password' ? raw : raw.trim();
  if (field.required && value === '') return false;
  // An optional field may stay empty, but what is typed has to be long enough.
  if (field.minLength && value !== '' && value.length < field.minLength) return false;
  return true;
}

function ConfirmDialog({
  options,
  onSettle,
}: {
  options: ConfirmOptions;
  onSettle: (result: ConfirmResult) => void;
}) {
  const { title, body, confirmLabel, cancelLabel = 'Cancel', typeToConfirm, onConfirm } = options;
  const fields = options.fields ?? [];
  const tone = options.tone ?? 'danger';

  const [values, setValues] = useState(() => initialValues(fields));
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  const ready =
    (!typeToConfirm || typed.trim() === typeToConfirm) &&
    fields.every((field) => satisfied(field, values[field.name] ?? ''));

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    // A field to fill takes focus; otherwise the safe choice does, so a stray
    // Enter — the reflex that opened the dialog in the first place — cancels.
    (firstFieldRef.current ?? cancelRef.current)?.focus();
    return () => opener?.focus?.();
  }, []);

  /** The first field rendered claims initial focus; later ones leave it alone. */
  function claimFocus(element: HTMLElement | null) {
    if (element && !firstFieldRef.current) firstFieldRef.current = element;
  }

  function cancel() {
    // An action already sent cannot be called back, so the dialog waits for it.
    if (!busy) onSettle(false);
  }

  /** Whether anything has been typed that a stray click would throw away. */
  const dirty =
    typed !== '' ||
    fields.some(
      (field) => (values[field.name] ?? '') !== (initialValues([field])[field.name] ?? ''),
    );

  function onKeyDown(event: React.KeyboardEvent) {
    // Nothing typed here may reach the global shortcuts underneath ("c" would
    // open a new case, "g" would start a navigation).
    event.stopPropagation();

    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key !== 'Tab' || !panelRef.current) return;

    const focusable = panelRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;

    const result = cleaned(fields, values);
    if (!onConfirm) {
      onSettle({ values: result });
      return;
    }

    setBusy(true);
    setFailure(null);
    try {
      await onConfirm(result);
      onSettle({ values: result });
    } catch (caught) {
      setBusy(false);
      setFailure(
        caught instanceof ApiError
          ? caught.detail
          : caught instanceof Error
            ? caught.message
            : 'Could not reach the server.',
      );
    }
  }

  function set(name: string, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  function renderField(field: ConfirmField) {
    const value = values[field.name] ?? '';
    const common = {
      value,
      placeholder: field.placeholder,
      maxLength: field.maxLength,
      required: field.required,
      disabled: busy,
    };

    switch (field.kind) {
      case 'textarea':
        return (
          <Textarea
            {...common}
            ref={claimFocus}
            rows={4}
            onChange={(event) => set(field.name, event.target.value)}
          />
        );
      case 'select':
        return (
          <Select
            value={value}
            disabled={busy}
            ref={claimFocus}
            onChange={(event) => set(field.name, event.target.value)}
          >
            {field.options?.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        );
      default:
        return (
          <Input
            {...common}
            ref={claimFocus}
            type={field.kind === 'password' ? 'password' : 'text'}
            autoComplete={
              field.autoComplete ??
              (field.kind === 'password'
                ? 'current-password'
                : field.kind === 'code'
                  ? 'one-time-code'
                  : 'off')
            }
            inputMode={field.kind === 'code' ? 'numeric' : undefined}
            className={field.kind === 'code' ? 'font-mono tracking-widest' : undefined}
            onChange={(event) => set(field.name, event.target.value)}
          />
        );
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      onKeyDown={onKeyDown}
    >
      {/* A click beside the dialog cancels only while there is nothing to lose;
          a half-written closing summary is not discarded by a missed click. */}
      <div className="absolute inset-0 bg-black/60" onClick={() => !dirty && cancel()} />
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={body ? bodyId : undefined}
        aria-busy={busy || undefined}
        className="animate-in relative max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-[var(--radius-panel)] border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-5 shadow-[var(--shadow-overlay)]"
      >
        <form onSubmit={onSubmit} className="space-y-4">
          <h2 id={titleId} className="text-base font-semibold tracking-tight">
            {title}
          </h2>

          {body && (
            <div id={bodyId} className="space-y-2 text-sm text-[var(--color-content-muted)]">
              {body}
            </div>
          )}

          {typeToConfirm && (
            // Not a Field: its label is set in capitals, and the phrase has to be
            // shown exactly as it must be typed.
            <label className="block space-y-1.5">
              <span className="text-xs text-[var(--color-content-muted)]">
                Type{' '}
                <code className="rounded bg-[var(--color-surface-overlay)] px-1 py-0.5 font-mono text-[var(--color-content)]">
                  {typeToConfirm}
                </code>{' '}
                to confirm
              </span>
              <Input
                ref={claimFocus}
                value={typed}
                disabled={busy}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
              />
            </label>
          )}

          {fields.map((field) => (
            <Field key={field.name} label={field.label} hint={field.hint}>
              {renderField(field)}
            </Field>
          ))}

          {failure && <Alert>{failure}</Alert>}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              ref={cancelRef}
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={cancel}
            >
              {cancelLabel}
            </Button>
            <Button
              type="submit"
              variant={tone === 'danger' ? 'danger' : 'primary'}
              disabled={!ready}
              loading={busy}
            >
              {confirmLabel}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
