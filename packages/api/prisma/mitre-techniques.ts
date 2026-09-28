/**
 * A curated subset of the MITRE ATT&CK Enterprise matrix.
 *
 * Bundled rather than fetched so the platform works on an isolated network.
 * Admins can extend the list later; ids follow the official notation so the
 * data stays compatible with a full import.
 */
export interface MitreSeed {
  id: string;
  name: string;
  tactic: string;
  parentId: string | null;
}

const t = (id: string, name: string, tactic: string, parentId: string | null = null): MitreSeed => ({
  id,
  name,
  tactic,
  parentId,
});

export const MITRE_TECHNIQUES: MitreSeed[] = [
  // Initial Access
  t('T1566', 'Phishing', 'Initial Access'),
  t('T1566.001', 'Spearphishing Attachment', 'Initial Access', 'T1566'),
  t('T1566.002', 'Spearphishing Link', 'Initial Access', 'T1566'),
  t('T1190', 'Exploit Public-Facing Application', 'Initial Access'),
  t('T1133', 'External Remote Services', 'Initial Access'),
  t('T1078', 'Valid Accounts', 'Initial Access'),
  t('T1189', 'Drive-by Compromise', 'Initial Access'),
  t('T1195', 'Supply Chain Compromise', 'Initial Access'),

  // Execution
  t('T1059', 'Command and Scripting Interpreter', 'Execution'),
  t('T1059.001', 'PowerShell', 'Execution', 'T1059'),
  t('T1059.003', 'Windows Command Shell', 'Execution', 'T1059'),
  t('T1204', 'User Execution', 'Execution'),
  t('T1053', 'Scheduled Task/Job', 'Execution'),

  // Persistence
  t('T1547', 'Boot or Logon Autostart Execution', 'Persistence'),
  t('T1136', 'Create Account', 'Persistence'),
  t('T1505.003', 'Web Shell', 'Persistence', 'T1505'),
  t('T1505', 'Server Software Component', 'Persistence'),

  // Privilege Escalation
  t('T1068', 'Exploitation for Privilege Escalation', 'Privilege Escalation'),
  t('T1548', 'Abuse Elevation Control Mechanism', 'Privilege Escalation'),

  // Defense Evasion
  t('T1070', 'Indicator Removal', 'Defense Evasion'),
  t('T1070.001', 'Clear Windows Event Logs', 'Defense Evasion', 'T1070'),
  t('T1027', 'Obfuscated Files or Information', 'Defense Evasion'),
  t('T1562', 'Impair Defenses', 'Defense Evasion'),
  t('T1562.001', 'Disable or Modify Tools', 'Defense Evasion', 'T1562'),
  t('T1036', 'Masquerading', 'Defense Evasion'),

  // Credential Access
  t('T1110', 'Brute Force', 'Credential Access'),
  t('T1110.001', 'Password Guessing', 'Credential Access', 'T1110'),
  t('T1110.003', 'Password Spraying', 'Credential Access', 'T1110'),
  t('T1003', 'OS Credential Dumping', 'Credential Access'),
  t('T1003.001', 'LSASS Memory', 'Credential Access', 'T1003'),
  t('T1555', 'Credentials from Password Stores', 'Credential Access'),
  t('T1621', 'Multi-Factor Authentication Request Generation', 'Credential Access'),

  // Discovery
  t('T1087', 'Account Discovery', 'Discovery'),
  t('T1046', 'Network Service Discovery', 'Discovery'),
  t('T1018', 'Remote System Discovery', 'Discovery'),
  t('T1082', 'System Information Discovery', 'Discovery'),

  // Lateral Movement
  t('T1021', 'Remote Services', 'Lateral Movement'),
  t('T1021.001', 'Remote Desktop Protocol', 'Lateral Movement', 'T1021'),
  t('T1021.002', 'SMB/Windows Admin Shares', 'Lateral Movement', 'T1021'),
  t('T1550', 'Use Alternate Authentication Material', 'Lateral Movement'),

  // Collection
  t('T1005', 'Data from Local System', 'Collection'),
  t('T1114', 'Email Collection', 'Collection'),
  t('T1056', 'Input Capture', 'Collection'),

  // Command and Control
  t('T1071', 'Application Layer Protocol', 'Command and Control'),
  t('T1071.001', 'Web Protocols', 'Command and Control', 'T1071'),
  t('T1105', 'Ingress Tool Transfer', 'Command and Control'),
  t('T1090', 'Proxy', 'Command and Control'),
  t('T1573', 'Encrypted Channel', 'Command and Control'),

  // Exfiltration
  t('T1041', 'Exfiltration Over C2 Channel', 'Exfiltration'),
  t('T1567', 'Exfiltration Over Web Service', 'Exfiltration'),
  t('T1048', 'Exfiltration Over Alternative Protocol', 'Exfiltration'),

  // Impact
  t('T1486', 'Data Encrypted for Impact', 'Impact'),
  t('T1490', 'Inhibit System Recovery', 'Impact'),
  t('T1498', 'Network Denial of Service', 'Impact'),
  t('T1531', 'Account Access Removal', 'Impact'),
];
