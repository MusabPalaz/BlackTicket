# Black Ticket — Analyst Guide

This guide is for everyone who works cases: SOC analysts and SOC leads. The
administration screens are covered in the [administrator guide](admin-guide.md).
For a step-by-step walkthrough with screenshots, see the
[L1 Analyst Runbook](L1-Analyst-Runbook.pdf).

Screen labels are quoted `like this`, exactly as they appear in the interface, so
you can find the button you are looking for.

---

## 1. Signing in

If your organisation has enabled single sign-on (SSO), the sign-in screen shows a
`Sign in with your organisation account` button; you sign in with your
organisation account and have no separate Black Ticket password.

Without SSO you sign in with a username and password:

- At your first sign-in you are asked to change your password. The temporary
  password from your administrator works once.
- If two-factor authentication is on for your account, the six-digit code is
  asked **after** the password has been accepted. The code screen only appears
  once the password is correct — deliberately: otherwise anyone could tell from
  outside which accounts have 2FA.
- You can also type one of your recovery codes in place of the six digits.

After five wrong attempts the account is locked for 15 minutes. Every sign-in —
successful or not — is written to the audit log.

---

## 2. Screen layout

**Top bar**: search box, notification bell, profile menu.

The search box looks at what you type: if it looks like an indicator (IP, hash,
domain), it takes you to IOC search; otherwise to case search.

**Sidebar**, in two parts: daily work at the top (`Dashboard`, `Cases`, `Alerts`,
`Observables`), `Administration` at the bottom. You only see the administration
section if you have the rights — if you cannot see it, that is your role, not a
bug.

### Shortcuts

| Key | Action |
|---|---|
| `g` then `d` | Dashboard |
| `g` then `c` | Cases |
| `g` then `a` | Alerts |
| `g` then `o` | Observables |
| `/` | Focus the search box |
| `c` | Open a new case |
| `?` | Shortcut help |
| `Esc` | Close the open panel / leave the field |

Shortcuts do not fire while a text field has focus; typing "c" in the search box
does not open a form.

---

## 3. Dashboard

A summary of open work and SLA pressure. The dashboard **is yours**: with
`Edit dashboard` you add, remove and reorder widgets and set their widths; press
`Done` when finished. The layout is stored with your account and follows you to
another machine.

**Every number on the dashboard is clickable.** Clicking a bar, a slice, a day
column or an SLA row takes you to the records behind it, and the target page
shows which filter was applied as a chip — removable with one click. You never
have to rebuild the filter by hand after seeing "7 breached".

---

## 4. Alerts — incoming detections

SIEM/EDR systems send alerts through the API. The `Alerts` screen is their queue.
An analyst can do two things with an alert; a SOC lead or administrator can also
ignore it, or put an ignored one back:

**`Open case`** — turns the alert into a new case. The indicators the alert carries
are added to the case as observables and correlation runs immediately: if the same
indicator was seen on another case before, the screen tells you.

**`Merge`** — adds the alert to an **existing** case (`Merge into an existing case`).
Used when a second or third alert for the same incident arrives. Indicators already
on the case are not added twice; the screen shows separately which ones are new and
which were already there.

**`Ignore`** *(SOC lead and administrator)* — dismisses the alert without a case.
A dialog asks for confirmation and an optional reason, which is written to the
audit log (left empty, it records *"Dismissed from the queue"*). An alert that has
already been imported cannot be ignored. Ignored alerts stay under the `IGNORED`
filter, where they can still be opened as a case.

**`Restore`** *(SOC lead and administrator)* — puts an ignored alert back in the
queue as `NEW`, again with an optional reason for the audit log.

`Open case` acts immediately; `Ignore` and `Restore` ask for confirmation first.
If an alert should be dismissed and you are an analyst, ask your SOC lead.

If the same alert is sent twice, the system accepts it once (the source + source
identifier pair is unique), so retries from an integration are safe.

---

## 5. Cases

### Opening a new case

The `c` shortcut, or `Cases` → `New case`. What the fields mean:

- **Title** — one sentence that still explains what this was when read in the list
  a month from now.
- **Severity** — LOW / MEDIUM / HIGH / CRITICAL. It sets the SLA target; change it
  later and the SLA is recalculated.
- **Incident time (`occurredAt`)** — the moment the incident happened, not the
  moment you opened the case. **The SLA clock starts here.** A case opened two
  hours after the incident is already two hours into its target; that is
  deliberate — the time belongs to the incident, not to the paperwork.
- **TLP** — who this information may be shared with (WHITE / GREEN / AMBER / RED).
- **PAP** — how aggressively the indicators may be investigated. Scanning an IP can
  tell the attacker they are being watched; PAP sets that limit.
- **Tags** — free text. A tag you type is saved to the catalogue and offered to
  others tomorrow. Not finding the right word in a list should never stop you from
  opening a case.

### Case Radar

The panel on the right of `New case` reads the title and description as you
type. Every indicator it finds — IP addresses, domains, URLs, hashes, e-mail
addresses, defanged ones like `185.220.101[.]4` included — is looked up at once:

- **Seen on N cases** — where it appeared before; the case numbers open in a new
  tab, so the form you are writing stays as it is.
- **Last verdict** — how the most recent closed case with this indicator ended
  (for example *TRUE POSITIVE*), with the start of its closing summary.
- **First sighting** — the team has not recorded it before.
- **Whitelisted / noisy · will not link** — it will be recorded but will not
  connect cases, exactly as correlation treats it.
- **Possible duplicate** — an open case already has some of these indicators.
  Check it before opening a second case for the same incident.

The ticked indicators are added to the case as observables when you open it, and
correlated straight away. Untick anything that is not part of the incident, such
as an example address in a pasted e-mail.

### Status flow

```
NEW ──→ IN_PROGRESS ──→ RESOLVED ──→ CLOSED
 │           ↑↓                          │
 └──→ PENDING                            │
              ↖──────────────────────────┘  (reopen)
```

`PENDING` is for waiting on an outside reply. `RESOLVED` says the work is done,
`CLOSED` that the record is closed. A closed case can be reopened; that also goes
to the audit log.

### Assignment rules

- An **analyst** can take an unassigned case **for themselves** and release their
  own case.
- Giving a case to **someone else** is a SOC lead's job.
- You cannot take a case that is assigned to someone else; the screen tells you so.

`Take case` also sets the case to `IN_PROGRESS` and stamps the **first response**
time: the first-response SLA stops at that moment. Opening a case from an alert
makes you its reporter but does not assign it to you.

When a case is assigned to you, you get a notification (and an e-mail too, if your
organisation has enabled outbound mail). You are not notified about a case you took
yourself — you already know.

---

## 6. The case screen

Five tabs. The counts in brackets on the tab headings show what is inside, so you
know without looking.

### `Overview`
The case record: status, severity, TLP/PAP, assignee, SLA times, MITRE ATT&CK
techniques, summary. When closing, you are asked to choose a `Resolution` and write
a summary.

### `Tasks`
The to-do list. Every task carries a **question** — that is the difference between a
note saying "handled" and a record that is still useful a month later.

- The marker on the left both shows the status and is a one-click complete button.
- Write the answer in the field under the question and press `Add` (`Ctrl/Cmd+Enter`
  also submits).
- Answers cannot be edited afterwards — they are the record. To correct one, add a
  new answer beneath it.
- Progress at the top: "6 of 13 answered · 4 done".

When you tag a case, the matching **playbook** is applied automatically and that
type's checklist arrives. If you change the tags later you can apply the playbook
again; it does not create duplicate tasks.

### `Observables`
The case's indicators: IP, domain, URL, hash, e-mail, username, file name and more.

- Marking an indicator as **`IOC`** means "this is malicious". Merely having been
  seen does not make it an IOC. Indicators you add arrive flagged as IOC by default;
  untick the flag for victim accounts, your own infrastructure and legitimate
  services.
- Pasted text is scanned for indicators automatically. Check the type of every row
  before adding: usernames with a dot in them can be mistaken for domain names.
- Values are stored normalised (defanged forms such as `hxxp://` included), so the
  same indicator written differently does not become two records.
- Correlation runs the moment you add an indicator.

### `Related cases`
Shows two kinds of link:

- **Automatic** — cases that share an indicator. The system finds them and tells you
  which indicator they have in common.
- **Manual** — you link them with `Link Another Case` and write a **reason**.

If a shared indicator is correlation noise (such as the organisation's own egress
IP), a SOC lead can add it to the `Correlation Whitelist`; that indicator will not
link cases again.

### `Attack Map`
The campaign this case belongs to, and where it may go next. It is built from what
the team already has: correlation links and the ATT&CK techniques tagged on cases.

- **Kill Chain** — the fourteen ATT&CK stages. Stages reached somewhere in the
  campaign are filled, a dot marks this case's own, and the likely next stages are
  outlined in orange.
- **Campaign** — this case and the cases linked to it (up to three links out, at
  most 40 cases), left to right in the order they happened. Arcs are correlations
  (dashed where an analyst made the link); hover one to see the shared indicators.
  Each case sits in the lanes of the tactics tagged on it. Click a case to open
  its own map.
- **Next Likely Moves** — two answers, kept apart. *From your own history*: in
  other campaigns, which techniques the next linked case carried after these ones,
  and how often. *From the ATT&CK kill chain*: the stages that follow the furthest
  one reached, with the techniques your team tags most under them.

These are patterns, not certainties. They get better as more cases are tagged with
techniques and linked by their indicators.

### `Timeline`
Who did what, and when. Activity only; answer texts stay on their task. Grouped by
day, with things that happened at the same moment collected on one line ("added 13
tasks").

---

## 7. Indicators and global search

The `Observables` screen searches **across all cases**. Type an IP; you get, on one
screen, which cases that indicator appeared on, when, and how many times. It is the
fastest way to ask whether an incident has happened to you before.

The `sightings` view gives an indicator's history: first seen, last seen, number of
cases.

### Looking an indicator up outside

Next to every indicator there is a small search button; right-clicking the
indicator opens the same menu. It lists the services an administrator set up —
VirusTotal, IBM X-Force Exchange, AbuseIPDB and others — and opens the one you pick
in a new tab. It is on a case's `Observables` tab, on this search screen, in the
alert queue and in the new-case radar.

Only lookups that make sense are offered. Private addresses (192.168.x.x, 10.x.x.x
and the like), internal names and the organisation's own domains are never sent to
outside services, nor are hostnames or usernames, and an address-only service such
as AbuseIPDB does not appear for a domain. An indicator with nothing to offer has no
button. In-house tools an administrator added — a CMDB, for example — are marked
`in-house` and appear for internal indicators too.

A lookup sends the indicator to that service. For a case marked **PAP:RED**, or an
indicator marked **TLP:RED**, the menu offers no outside service and says why.

---

## 8. SLA

Two separate clocks run:

| Clock | Stops when |
|---|---|
| **First response** | Someone takes the case |
| **Resolution** | The case is resolved |

Both start from the **incident time**, not from when the case was opened. The
targets are set per severity by administrators.

When a target is missed, the case is flagged, it shows up in the SLA widget on the
dashboard, and its owner is notified. If an SLA target is changed later, the due
dates of **existing cases** do not change — the record shows what was promised on
the day.

---

## 9. Notifications

The bell at the top right carries the unread count. Events that raise a
notification: a case being assigned to you, a case you own breaching its SLA, a
case nobody has taken yet, and the alert queue passing its threshold.

If your organisation has configured outbound mail, the same events arrive as
e-mail too, so you hear about them when you are away from the screen. Nothing about
passwords or two-factor authentication is ever sent by e-mail.

---

## 10. "Why can't I do this?"

| Situation | Reason |
|---|---|
| I cannot take someone else's case | Analysts can only take cases for themselves; a SOC lead assigns |
| I cannot see the administration menu | Your role does not have that permission |
| I have no `Ignore` button | Dismissing alerts is for SOC leads and administrators |
| I cannot ignore an imported alert | The alert has already become a case |
| I cannot edit a closed case | Reopen it first; that is recorded too |
| I cannot edit my task answer | Answers are the record; add a correcting answer beneath it |
| The same alert does not appear twice | The source + identifier pair is unique; resending is safe |
| The password field on the sign-in screen does not work | Your organisation has moved to SSO; sign in with your organisation account |

Where you get stuck, the message on screen usually states the reason too. If it
does not, ask a SOC lead or an administrator; every action is in the audit log, so
what happened can always be found.
