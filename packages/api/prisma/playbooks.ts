/**
 * Seeded tag vocabulary and task playbooks.
 *
 * A playbook turns "write up what you did" into a set of questions to answer,
 * which is the difference between a case note somebody can act on next month
 * and one that says "handled". Which questions appear depends on what kind of
 * case it is: a phishing report and an EDR detection need different answers.
 *
 * Everything here is a starting point — administrators edit the playbooks in
 * the console, and the seed never overwrites a template that already exists.
 */

export interface TagSeed {
  name: string;
  description: string;
  color: string;
}

export const TAG_CATALOGUE: TagSeed[] = [
  { name: 'phishing', description: 'Credential or payload delivery by e-mail', color: '#f59e0b' },
  { name: 'business-email-compromise', description: 'Impersonation of a known sender', color: '#f97316' },
  { name: 'spam', description: 'Unsolicited bulk mail, no clear malice', color: '#94a3b8' },
  { name: 'malware', description: 'Malicious code on an endpoint or server', color: '#ef4444' },
  { name: 'ransomware', description: 'Encryption or extortion activity', color: '#b91c1c' },
  { name: 'edr', description: 'Detection raised by the endpoint agent', color: '#8b5cf6' },
  { name: 'xdr', description: 'Correlated detection from the XDR platform', color: '#7c3aed' },
  { name: 'siem', description: 'Detection raised by a SIEM rule', color: '#6366f1' },
  { name: 'brute-force', description: 'Repeated authentication attempts', color: '#a855f7' },
  { name: 'password-spray', description: 'Few passwords against many accounts', color: '#c026d3' },
  { name: 'suspicious-login', description: 'Improbable travel, new device, odd hours', color: '#ec4899' },
  { name: 'account-compromise', description: 'Confirmed unauthorised account use', color: '#db2777' },
  { name: 'privilege-escalation', description: 'Attempt to gain higher rights', color: '#e11d48' },
  { name: 'lateral-movement', description: 'Movement between hosts inside the estate', color: '#f43f5e' },
  { name: 'c2', description: 'Command and control traffic', color: '#0ea5e9' },
  { name: 'data-exfiltration', description: 'Data leaving the estate', color: '#0284c7' },
  { name: 'insider', description: 'Activity by someone with legitimate access', color: '#14b8a6' },
  { name: 'vulnerability', description: 'Exposed or unpatched service', color: '#84cc16' },
  { name: 'policy-violation', description: 'Acceptable-use or policy breach', color: '#64748b' },
  { name: 'dos', description: 'Availability impact', color: '#f97316' },
  { name: 'false-positive', description: 'Detection that turned out to be benign', color: '#6b7280' },
  { name: 'threat-intel', description: 'Raised from an external intelligence feed', color: '#22c55e' },
];

export interface TemplateSeed {
  name: string;
  description: string;
  isDefault: boolean;
  matchTags: string[];
  matchCategories: string[];
  sortOrder: number;
  items: { title: string; prompt: string }[];
}

export const TASK_TEMPLATES: TemplateSeed[] = [
  {
    name: 'Standard triage',
    description: 'Applied to every case. The questions any write-up has to answer.',
    isDefault: true,
    matchTags: [],
    matchCategories: [],
    sortOrder: 10,
    items: [
      {
        title: 'Log Review',
        prompt: 'Which logs were reviewed, over what time window, and what did they actually show?',
      },
      {
        title: 'False Positive',
        prompt:
          'True or false positive? State the evidence for the verdict — a detection dismissed without one is guesswork.',
      },
      {
        title: 'Enterprise Search',
        prompt:
          'Search the estate for the same indicators. How many other hosts, users or mailboxes are involved?',
      },
      {
        title: 'Containment',
        prompt: 'What containment was applied, at what time, by whom, and on whose authority?',
      },
      {
        title: 'Executive Summary',
        prompt:
          'Two or three sentences a manager can read: what happened, what the impact was, and what was done about it.',
      },
    ],
  },
  {
    name: 'Phishing response',
    description: 'Mail-borne cases: sender, recipients, payload and clean-up.',
    isDefault: false,
    matchTags: ['phishing', 'business-email-compromise', 'spam'],
    matchCategories: ['phishing'],
    sortOrder: 20,
    items: [
      {
        title: 'Header Analysis',
        prompt:
          'What do the headers show — SPF, DKIM, DMARC results, return path, and the true sending infrastructure?',
      },
      {
        title: 'Block Sender',
        prompt: 'Was the sender address or domain blocked at the gateway? Record the rule that was added.',
      },
      {
        title: 'Domain Block',
        prompt: 'Which domains or URLs were blocked, and where — proxy, DNS, firewall?',
      },
      {
        title: 'Purge',
        prompt:
          'Were the messages purged from every recipient mailbox? How many recipients, and how many had already opened it?',
      },
      {
        title: 'Password Reset',
        prompt:
          'Whose credentials were reset, and were their sessions revoked as well? A reset without revocation leaves the attacker signed in.',
      },
    ],
  },
  {
    name: 'EDR / XDR detection',
    description: 'Endpoint and correlated detections: who, which host, and what was done to it.',
    isDefault: false,
    matchTags: ['edr', 'xdr', 'malware', 'ransomware', 'lateral-movement', 'c2', 'privilege-escalation'],
    matchCategories: ['malware', 'ransomware'],
    sortOrder: 30,
    items: [
      {
        title: 'Affected User',
        prompt: 'Which account is involved? Role, department, and what normal behaviour looks like for them.',
      },
      {
        title: 'Affected Host',
        prompt: 'Which host? Owner, operating system, patch level, and what the machine is used for.',
      },
      {
        title: 'Insider Threat',
        prompt:
          'Is there any indication this was deliberate and internal rather than an outside intrusion? What supports that reading?',
      },
      {
        title: 'IP Block',
        prompt: 'Which addresses or ranges were blocked, and at which control point?',
      },
      {
        title: 'Disablement',
        prompt: 'Was the account or service disabled? When, and who approved it?',
      },
      {
        title: 'Re-image',
        prompt: 'Does the host need re-imaging? Record the decision, the reasoning and the build ticket.',
      },
      {
        title: 'Notify constituents (status update)',
        prompt: 'Who was told, through which channel, and what were they told?',
      },
      {
        title: 'Remove temporary containment measures',
        prompt:
          'Which temporary blocks, isolations or disablements were lifted once the case closed? Anything left in place becomes tomorrow’s outage.',
      },
    ],
  },
];
