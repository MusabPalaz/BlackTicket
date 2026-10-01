import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Role } from '@black-ticket/shared';
import { api, ApiError } from '@/lib/api';
import { Alert, Badge, Button, Card, Field, Input, Select, cx } from '@/components/ui';
import { useConfirm } from '@/components/ConfirmDialog';
import { SsoDocsCards } from './SsoDocsCards';

interface RoleMapping {
  groupId: string;
  groupName: string;
  role: Role;
}

interface AuthPolicyView {
  mode: 'LOCAL' | 'SSO';
  oidc: {
    issuer: string;
    clientId: string;
    redirectUri: string;
    scopes: string[];
    usernameClaim: string;
    groupsClaim: string;
    clientSecretConfigured: boolean;
  } | null;
  roleMap: RoleMapping[];
  defaultRole: Role | null;
  updatedAt: string | null;
  hasRecoveryAccount: boolean;
}

const ENDPOINT = '/admin/settings/auth-policy';

/**
 * Federated sign-in.
 *
 * Single sign-on is a feature a tenant switches on, not a mode the product
 * ships in: with it off nothing on this screen affects anything. The screen is
 * therefore arranged around the switch, and refuses to throw it until there is
 * a way back in should the provider fail.
 */
export function SsoSettingsPage() {
  const policy = useQuery({
    queryKey: ['auth-policy'],
    queryFn: () => api.get<AuthPolicyView>(ENDPOINT),
  });

  if (policy.isLoading || !policy.data) {
    return <div className="p-8 text-sm text-[var(--color-content-muted)]">Loading…</div>;
  }

  /*
   * Keyed on the stored revision rather than syncing server data into form
   * state with an effect. A save changes updatedAt, the editor remounts, and
   * its fields come back from what was actually persisted.
   */
  return <PolicyEditor key={policy.data.updatedAt ?? 'initial'} current={policy.data} />;
}

function PolicyEditor({ current }: { current: AuthPolicyView }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const [issuer, setIssuer] = useState(current.oidc?.issuer ?? '');
  const [clientId, setClientId] = useState(current.oidc?.clientId ?? '');
  const [clientSecret, setClientSecret] = useState('');
  const [redirectUri, setRedirectUri] = useState(
    current.oidc?.redirectUri ?? `${window.location.origin}/api/v1/auth/sso/callback`,
  );
  const [usernameClaim, setUsernameClaim] = useState(
    current.oidc?.usernameClaim ?? 'preferred_username',
  );
  const [groupsClaim, setGroupsClaim] = useState(current.oidc?.groupsClaim ?? 'groups');
  const [defaultRole, setDefaultRole] = useState<Role | ''>(current.defaultRole ?? '');
  const [roleMap, setRoleMap] = useState<RoleMapping[]>(current.roleMap);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<{ ok: boolean; detail: string } | null>(null);

  function settled(message: string) {
    setError(null);
    setNotice(message);
    void queryClient.invalidateQueries({ queryKey: ['auth-policy'] });
  }

  function failed(caught: unknown) {
    setNotice(null);
    setError(caught instanceof ApiError ? caught.detail : 'Could not reach the server.');
  }

  const save = useMutation({
    mutationFn: (mode: 'LOCAL' | 'SSO') =>
      api.put<AuthPolicyView>(ENDPOINT, {
        mode,
        issuer,
        clientId,
        ...(clientSecret ? { clientSecret } : {}),
        redirectUri,
        usernameClaim,
        groupsClaim,
        roleMap,
        defaultRole: defaultRole === '' ? null : defaultRole,
      }),
    onSuccess: (_result, mode) => {
      setClientSecret('');
      settled(
        mode === 'SSO'
          ? 'Single sign-on is on. Keep this tab open and test in a private window before signing out.'
          : 'Saved. Single sign-on stays off until you turn it on.',
      );
    },
    onError: failed,
  });

  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; detail: string }>(`${ENDPOINT}/test`, {}),
    onSuccess: (result) => {
      setProbe(result);
      setError(null);
    },
    onError: failed,
  });

  const ssoOn = current.mode === 'SSO';
  const configured = current.oidc !== null;

  return (
    <div className="max-w-6xl space-y-5 p-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Single sign-on</h1>
        <p className="mt-1 text-sm text-[var(--color-content-muted)]">
          Let people sign in with the organisation directory instead of a local password.
        </p>
      </header>

      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <Alert>{error}</Alert>}

      {/* Controls on the left, the reference for them on the right — the same
          arrangement the system settings screen uses. */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-5">
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Current policy">
              <dl className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-[var(--color-content-muted)]">Sign-in</dt>
                  <dd>
                    {ssoOn ? (
                      <Badge tone="good">Single sign-on</Badge>
                    ) : (
                      <Badge>Local accounts</Badge>
                    )}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-[var(--color-content-muted)]">Provider</dt>
                  <dd className="max-w-[60%] truncate font-mono text-xs">
                    {current.oidc?.issuer ?? 'not configured'}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-[var(--color-content-muted)]">Break-glass account</dt>
                  <dd>
                    {current.hasRecoveryAccount ? (
                      <Badge tone="good">Present</Badge>
                    ) : (
                      <Badge tone="warn">Missing</Badge>
                    )}
                  </dd>
                </div>
              </dl>
            </Card>

            <Card title="Connection">
              <div className="space-y-3">
                <p className="text-sm text-[var(--color-content-muted)]">
                  Checks that the issuer answers its discovery document with the stored credentials.
                </p>
                {probe && <Alert tone={probe.ok ? 'success' : 'warning'}>{probe.detail}</Alert>}
                <Button
                  variant="secondary"
                  disabled={!configured}
                  loading={test.isPending}
                  onClick={() => test.mutate()}
                >
                  Test connection
                </Button>
              </div>
            </Card>
          </div>

          {!current.hasRecoveryAccount && (
            <Alert tone="warning">
              No active break-glass account exists. Single sign-on cannot be switched on until there
              is one: a wrong issuer or an expired client secret would otherwise leave nobody able
              to sign in, and nobody able to undo it.
            </Alert>
          )}

          <Card title="Identity provider">
            <form
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                save.mutate(current.mode);
              }}
              className="space-y-4"
            >
              <Field
                label="Issuer"
                hint="Discovery base — for Entra, https://login.microsoftonline.com/<tenant>/v2.0"
              >
                <Input
                  value={issuer}
                  onChange={(event) => setIssuer(event.target.value)}
                  placeholder="https://login.microsoftonline.com/<tenant>/v2.0"
                  className="font-mono text-xs"
                  required
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Client id">
                  <Input
                    value={clientId}
                    onChange={(event) => setClientId(event.target.value)}
                    className="font-mono text-xs"
                    required
                  />
                </Field>
                <Field
                  label="Client secret"
                  hint={
                    current.oidc?.clientSecretConfigured
                      ? 'Stored. Leave blank to keep it.'
                      : 'Required the first time.'
                  }
                >
                  <Input
                    type="password"
                    value={clientSecret}
                    onChange={(event) => setClientSecret(event.target.value)}
                    autoComplete="new-password"
                    placeholder={current.oidc?.clientSecretConfigured ? '••••••••' : ''}
                  />
                </Field>
              </div>

              <Field label="Redirect URI" hint="Register this exact value with the provider">
                <Input
                  value={redirectUri}
                  onChange={(event) => setRedirectUri(event.target.value)}
                  className="font-mono text-xs"
                  required
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Username claim">
                  <Input
                    value={usernameClaim}
                    onChange={(event) => setUsernameClaim(event.target.value)}
                    className="font-mono text-xs"
                  />
                </Field>
                <Field label="Groups claim">
                  <Input
                    value={groupsClaim}
                    onChange={(event) => setGroupsClaim(event.target.value)}
                    className="font-mono text-xs"
                  />
                </Field>
              </div>

              <div className="flex justify-end">
                <Button type="submit" loading={save.isPending}>
                  Save provider
                </Button>
              </div>
            </form>
          </Card>

          <Card
            title="Role mapping"
            description="Evaluated in order; the first directory group someone belongs to wins."
          >
            <div className="space-y-3">
              {roleMap.length === 0 && (
                <p className="text-sm text-[var(--color-content-muted)]">No groups mapped yet.</p>
              )}

              {roleMap.map((mapping, index) => (
                <div key={index} className="flex flex-wrap items-end gap-3">
                  <Field label="Group id">
                    <Input
                      value={mapping.groupId}
                      onChange={(event) =>
                        setRoleMap(
                          replaceAt(roleMap, index, { ...mapping, groupId: event.target.value }),
                        )
                      }
                      className="font-mono text-xs"
                    />
                  </Field>
                  <Field label="Name">
                    <Input
                      value={mapping.groupName}
                      onChange={(event) =>
                        setRoleMap(
                          replaceAt(roleMap, index, { ...mapping, groupName: event.target.value }),
                        )
                      }
                    />
                  </Field>
                  <Field label="Role">
                    <Select
                      value={mapping.role}
                      onChange={(event) =>
                        setRoleMap(
                          replaceAt(roleMap, index, {
                            ...mapping,
                            role: event.target.value as Role,
                          }),
                        )
                      }
                    >
                      {Object.values(Role).map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => setRoleMap(roleMap.filter((_, i) => i !== index))}
                  >
                    Remove
                  </Button>
                </div>
              ))}

              <div className="flex flex-wrap items-end justify-between gap-3">
                <Field label="Unmapped users" hint="What someone in none of these groups gets">
                  <Select
                    value={defaultRole}
                    onChange={(event) => setDefaultRole(event.target.value as Role | '')}
                  >
                    <option value="">Refuse the sign-in</option>
                    {Object.values(Role).map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </Select>
                </Field>

                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() =>
                      setRoleMap([...roleMap, { groupId: '', groupName: '', role: Role.ANALYST }])
                    }
                  >
                    Add group
                  </Button>
                  <Button loading={save.isPending} onClick={() => save.mutate(current.mode)}>
                    Save mapping
                  </Button>
                </div>
              </div>
            </div>
          </Card>

          <Card title={ssoOn ? 'Turn single sign-on off' : 'Turn single sign-on on'}>
            <div className="space-y-3">
              <p className="text-sm text-[var(--color-content-muted)]">
                {ssoOn
                  ? 'Local passwords start working again for every account that has one. Provisioned accounts have none, so they will not be able to sign in until this is turned back on.'
                  : 'Everyone signs in through the provider. Local passwords keep working only for the break-glass account.'}
              </p>
              <div className={cx('flex justify-end')}>
                <Button
                  variant={ssoOn ? 'secondary' : 'primary'}
                  disabled={!ssoOn && (!configured || !current.hasRecoveryAccount)}
                  loading={save.isPending}
                  onClick={async () => {
                    const ok = await confirm(
                      ssoOn
                        ? {
                            title: 'Switch back to local accounts?',
                            body: (
                              <p>
                                Accounts created by single sign-on have no local password, so they
                                cannot sign in until it is turned back on.
                              </p>
                            ),
                            confirmLabel: 'Switch to local accounts',
                          }
                        : {
                            title: 'Turn single sign-on on?',
                            body: (
                              <>
                                <p>
                                  From the next sign-in everyone goes through the identity provider;
                                  local passwords keep working for the break-glass account only.
                                </p>
                                <p>
                                  Keep this tab open and try a sign-in in a private window before
                                  you sign out.
                                </p>
                              </>
                            ),
                            confirmLabel: 'Turn on single sign-on',
                          },
                    );
                    if (ok) save.mutate(ssoOn ? 'LOCAL' : 'SSO');
                  }}
                >
                  {ssoOn ? 'Switch back to local accounts' : 'Enable single sign-on'}
                </Button>
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <SsoDocsCards />
        </div>
      </div>
    </div>
  );
}

function replaceAt<T>(list: T[], index: number, value: T): T[] {
  return list.map((entry, i) => (i === index ? value : entry));
}
