/**
 * The ATT&CK Enterprise tactics in kill-chain order — the order an intrusion
 * tends to move through them. The attack map lays cases out along it, and
 * "what usually comes next" is read from it when the team's own history has
 * nothing to say.
 */
export const ATTACK_TACTICS = [
  { name: 'Reconnaissance', short: 'Recon' },
  { name: 'Resource Development', short: 'Resource Dev' },
  { name: 'Initial Access', short: 'Initial Access' },
  { name: 'Execution', short: 'Execution' },
  { name: 'Persistence', short: 'Persistence' },
  { name: 'Privilege Escalation', short: 'Priv. Escalation' },
  { name: 'Defense Evasion', short: 'Defense Evasion' },
  { name: 'Credential Access', short: 'Credential Access' },
  { name: 'Discovery', short: 'Discovery' },
  { name: 'Lateral Movement', short: 'Lateral Movement' },
  { name: 'Collection', short: 'Collection' },
  { name: 'Command and Control', short: 'C2' },
  { name: 'Exfiltration', short: 'Exfiltration' },
  { name: 'Impact', short: 'Impact' },
] as const;

/** Position in the kill chain, or -1 for a tactic name the list does not know. */
export function tacticIndex(tactic: string): number {
  return ATTACK_TACTICS.findIndex((entry) => entry.name === tactic);
}
