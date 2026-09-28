# Black Ticket — Administrator Guide

This guide is for those who use the `Administration` section. Day-to-day case work
is covered in the [analyst guide](analyst-guide.md).

Screen labels are quoted `like this`.

---

## 1. Roles

| Role | What it does |
|---|---|
| **ADMIN** | Everything: accounts, roles, API keys, system settings, deleting cases |
| **SOC_LEAD** | Analyst rights + assigning/closing any case, the audit log, taxonomy (categories, playbooks, whitelist) |
| **ANALYST** | Opening cases, updating/closing their own cases, self-assignment, managing tasks and indicators, handling alerts |
| **READ_ONLY** | Read only: cases, alerts, dashboard |

Two rules are not negotiable, and no screen can bend them:

- The **last active administrator** cannot be disabled, deleted or demoted.
- The **recovery account** (`break-glass`) can never be deleted, disabled or have
  its role changed — not even by directory sync.

---

## 2. Account management (`Accounts`)

### Creating a single account
You set the username, the full name and **the password**. The password goes through
a strength check: length alone is not enough, and passwords resembling the account's
own details are refused (such as `admin2026` for the user `admin`). The user must
change the password at first sign-in.

If an organisation domain is configured, the e-mail address is derived from the
username.

### Bulk import
Hundreds of accounts can be created from a CSV file.

- **A dry run is the default.** You check first with `Check without importing`; the
  `Import for real` button only becomes active after the check has run.
- **Rows are processed independently.** In an 800-row file one broken row does not
  cancel the other 799; each row gets its own result with its row number.
- A temporary password is generated for every account, and changing it at first
  sign-in is mandatory.

### Account lifecycle
- **`Disable`** — closes the account and ends its sessions. The records stay.
- **`Reset password`** — generates a temporary password and shows it to you; you
  pass it on to the user. Changing it at first sign-in is mandatory.
- **`Reset 2FA`** — for when the user loses their phone. They need to set it up again.
- **`Force logout`** — revokes all of their sessions.
- **`Delete…`** — soft delete. An account with open cases cannot be deleted; hand
  the work over first. For bulk deletion you confirm by typing how many accounts
  will be affected.

Accounts are never really removed from the database, because cases refer to the
people who opened and took them; this keeps the history from being orphaned.

---

## 3. Organisation domain (`Organisation domain`)

You enter the organisation's e-mail domain and **lock** it. While it is locked,
every account — created by hand, imported from CSV, or arriving through SSO — must
be in that domain.

Unlocking is a separate operation: it asks for **an administrator password** and is
written to the audit log with its reason. While SSO is on, the account to do this is
the recovery account; if an account without a local password tries, the screen
directs it to the recovery account.

The sender address for outbound mail must also be inside this domain.

---

## 4. Single sign-on (`Single sign-on`)

SSO is **a feature you switch on and off**, not a mode of the product. While it is
off, nothing on this screen has any effect and the system works with local accounts
as before.

**Setup order:**

1. Register an application with the identity provider, and register the address
   shown on screen as its `Redirect URI`.
2. Fill in `Issuer`, `Client id` and `Client secret`, and press **`Save provider`**.
   Saving is not enabling.
3. Confirm the provider answers with **`Test connection`**.
4. Map directory groups to roles under `Role mapping`. Order matters: the **first**
   group the user belongs to wins.
5. The `Unmapped users` field says what someone who matches no group gets. The
   default is **to refuse the sign-in** — so that renaming a group never hands out
   access silently.
6. At the bottom, **`Enable single sign-on`**.

The screen **refuses to enable SSO if there is no active recovery account.** Otherwise
a wrong issuer, an expired client secret or an outage at the provider would leave a
system nobody can sign in to and nobody can roll back.

> **Keep the recovery account's password outside this system, somewhere your team
> can reach.** Unlocking the domain needs it too.

### Automatic account creation and removal (SCIM)

Signing in **creates** an account but never **closes** one: someone who leaves simply
stops signing in, and their account stays. SCIM closes that gap.

- Point your identity provider at `<server>/api/v1/scim/v2`.
- On the `API keys` screen, create a key with the purpose
  **`Provision accounts (SCIM directory sync)`** and give it as the secret token.
- When the directory deactivates someone, the system closes the account and ends
  its sessions.

SCIM **closes, it does not delete** — cases record who reported and who took them,
and deleting the person would orphan that history.

Three things the directory cannot do: take over the recovery account, demote the
last administrator, reopen an account that was closed here.

---

## 5. API keys (`API keys`)

A key's **purpose is fixed when it is created** and cannot be widened later:

- **`Submit alerts (SIEM / EDR)`** — can only submit alerts.
- **`Provision accounts (SCIM directory sync)`** — can only create and close accounts.

Neither can do the other's job; a leaked integration token is one problem, not two.

The full value of a key is shown **once**, when it is created. A lost key cannot be
recovered; it is replaced with a new one.

- **`revoke`** stops the key immediately and leaves it in the list.
- **`delete`** removes it permanently, and only appears once the key is revoked or
  expired — tidying up should never cut off a live integration. Alerts that came in
  with a deleted key remain, but which key they came with is lost.

SCIM keys are sent in the `Authorization: Bearer` header; Microsoft Entra does not
allow changing it. The system accepts both forms.

---

## 6. Outbound e-mail

The application has no mail server of its own. You provide a mailbox in your own
domain, and everything goes out from that address.

**`Outbound mail settings`** at the bottom of the `Organisation domain` screen:

- **SMTP** — for any provider that allows password authentication.
- **Microsoft Graph** — for Microsoft 365. M365 turns SMTP authentication off by
  default; on those tenants SMTP does not work however correct the password is.
  Graph needs the **`Mail.Send`** permission on the app registration, with admin
  consent.
- **`Test connection`** tests the credentials; **`Send test to me`** tests the whole
  path.
- Sending stays off until you press **`Turn on`**.

Events that trigger e-mail: a case being assigned to **someone else**, and a case
breaching its SLA. Nothing about passwords or 2FA is ever sent — with SSO those
belong to the identity provider, and the application never even sees them.

Messages are queued, never sent while someone waits. A slow or unreachable mail
server cannot slow down or fail a case assignment. The `Recent messages` table shows
what was sent and what happened to it, for 90 days.

> **The `Mail.Send` application permission reaches every mailbox in the tenant.**
> That is why the sender address is fixed in the configuration. We recommend
> narrowing it to a single mailbox in Exchange with `ApplicationAccessPolicy`.

---

## 7. System settings (`System settings`)

### Categories
The `slug` is the permanent identifier (lower case, hyphenated) and every case
stores it; the `name` is the label shown on screen and can be changed freely.
Categories are hidden, never deleted — so that past cases do not lose their
category.

### SLA targets
Two durations per severity: first response and resolution. Stored in minutes; the
hours/days next to the fields are the same number, just easier to read.

**Changing a target does not rewrite the due dates of existing cases.** The record
keeps showing what was promised on the day.

### SLA monitoring
Separate from the targets: the targets state the durations; this switch states
whether anyone is measured against them at all. In a team that does not work to an
SLA, monitoring left on raises a notification for every late case, and the bell
loses its meaning.

---

## 8. Playbooks (`Playbooks`)

Task checklists applied automatically by tag and category. Every task carries a
**question** for the analyst to answer.

Built in: *Standard triage* (every case), *Phishing response*, *EDR/XDR detection*.
You can add new ones and edit existing ones (SOC lead rights are enough).

Deleting a playbook does not delete the tasks created from it: the record is the
task itself, not the template.

---

## 9. Correlation whitelist (`Correlation whitelist`)

Indicators that should never link cases together: the organisation's own egress IP
range, `*.microsoft.com` and the like. You can write a CIDR range, a wildcard or an
exact value as the pattern.

Adding something here silences its correlation; the indicator is still recorded, it
just does not create links. Noise makes a correlation engine useless, which is why
this screen matters.

---

## 10. Audit trail (`Audit trail`)

Who did what, when, and from which IP. Filterable by person, action, entity and date.

**The audit trail is append-only at database level.** Updates and deletes are blocked
by a rule — in the database itself, not through the application. This is also why
users are soft-deleted rather than really deleted.

---

## 11. System health (`System health`)

Database size, row counts per table, and maintenance operations. The clean-up
function here **deletes every case, alert and indicator**, and keeps the people and
the configuration. It is for clearing an installation of demo data before real use.

---

## 12. Data retention

The system clears operational leftovers by itself at 4 a.m. every night. How long
each kind of data is kept is a **policy**, not a constant:

| Data | Default | What it is |
|---|---|---|
| Unfinished SSO sign-in attempts | 7 days | Ten-minute credentials; their only purpose is looking into a failed sign-in afterwards |
| Expired / revoked sessions | 30 days | Tokens that can no longer authenticate anyway. **A live session is never closed** |
| Read notifications | 90 days | Unread ones are never touched |
| Outbound e-mail log | 90 days | For answering "did it go out?" |
| Soft-deleted accounts and cases | **indefinite** | Off; turning it on is your decision |
| **Audit trail** | **indefinite** | See below |

The first four are safe to clear: none of them is visible in the interface, none of
them is evidence.

The last two are **off** by default on purpose. In this system, soft deletion already
means "invisible", and a case carries the record of an investigation; turning that
into permanent deletion on a timer is the organisation's decision, not the product's
default.

### The audit trail is a separate matter

The audit trail is **append-only at database level**, and that affects retention too:
a delete request from the application **does not fail — it silently deletes
nothing**. So a setting like "keep the audit trail for 2 years" does not make the
application delete anything — deliberately.

Pruning the audit trail is a separate, privileged operation; it needs a database role
that owns the table (the application's own user cannot and should not do this):

```powershell
# Dry run first: writes the archive, deletes nothing from the trail
./packages/api/scripts/maintenance/audit-archive.ps1 -OlderThanDays 730 -ArchiveDir D:/archives

# Actually delete
./packages/api/scripts/maintenance/audit-archive.ps1 -OlderThanDays 730 -ArchiveDir D:/archives -Confirm
```

In order, the script exports the entries to a JSONL file, compares the row count
with the table, switches the rule off, deletes and **switches it back on** inside a
single transaction, and writes what it did into the trail itself. If anything goes
wrong in between, the rollback puts the rule back — the trail never stays writable
because of a maintenance script that stopped halfway.

With the `-Database` parameter you can target a restored copy and rehearse. Do.

> **Archive files are evidence.** Keep them where the database dumps are, under the
> same access control.

**How long should you keep it?** That is a legal question, not a technical one:
whatever GDPR, KVKK, ISO 27001 or your sector's regulation says. The product does not
guess that number on your behalf.

---

## 13. Backup and restore

The procedure and scripts are in the [README](../README.md#backup-and-restore).

The one thing worth repeating here:

> **A database dump on its own is not a restorable backup.** TOTP seeds, the OIDC
> client secret and the mail password are stored encrypted in the database; the key
> is `TOTP_ENCRYPTION_KEY` in `.env`, and it is not in the dump. A restore without
> the key gives a system where everyone's 2FA is broken, SSO cannot authenticate and
> mail cannot send. Keep the key **separate** from the dumps.

**Test** a restore from time to time. An untested backup is not a backup.

---

## 14. Operations checklist

**Weekly**
- `System health`: is the database growing as expected?
- `Audit trail`: any unexpected role changes, unlocks, key creation?
- `Outbound mail` → `Recent messages`: have failed sends piled up?
- `API keys`: any keys no longer in use? Revoke first, then delete.

**Monthly**
- A restore rehearsal from backup (into a separate database).
- `Accounts`: are the accounts of people who left closed? With SCIM this should
  happen by itself; without it, check by hand.
- Can the recovery account's password still be reached?

**After a change**
- If the identity provider settings changed: `Test connection` **and** a real sign-in
  in a private window. After changing SSO settings, do not close the tab you have
  open; it is the easiest way to undo a wrong setting.
- If the mail settings changed: `Send test to me`.
