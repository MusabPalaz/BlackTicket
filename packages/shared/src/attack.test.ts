import { describe, expect, it } from 'vitest';
import { ATTACK_TACTICS, tacticIndex } from './attack';

describe('ATT&CK kill chain', () => {
  it('lists the fourteen Enterprise tactics once each', () => {
    const names = ATTACK_TACTICS.map((tactic) => tactic.name);
    expect(names).toHaveLength(14);
    expect(new Set(names).size).toBe(14);
  });

  it('runs from reconnaissance to impact', () => {
    expect(tacticIndex('Reconnaissance')).toBe(0);
    expect(tacticIndex('Initial Access')).toBeLessThan(tacticIndex('Lateral Movement'));
    expect(tacticIndex('Exfiltration')).toBeLessThan(tacticIndex('Impact'));
    expect(tacticIndex('Impact')).toBe(13);
  });

  it('knows every tactic the bundled technique catalogue uses', () => {
    for (const tactic of [
      'Initial Access',
      'Execution',
      'Persistence',
      'Privilege Escalation',
      'Defense Evasion',
      'Credential Access',
      'Discovery',
      'Lateral Movement',
      'Collection',
      'Command and Control',
      'Exfiltration',
      'Impact',
    ]) {
      expect(tacticIndex(tactic), tactic).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns -1 for an unknown tactic', () => {
    expect(tacticIndex('Teleportation')).toBe(-1);
  });
});
