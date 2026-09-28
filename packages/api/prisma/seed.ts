/**
 * Idempotent seed: safe to re-run. It never overwrites an existing admin
 * password and never reactivates something an administrator disabled.
 *
 *   npm run db:seed
 */
import { PrismaClient, ObservableType, Severity } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from '@node-rs/argon2';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { MITRE_TECHNIQUES } from './mitre-techniques';
import { TAG_CATALOGUE, TASK_TEMPLATES } from './playbooks';
import { ARGON2_OPTIONS } from '../src/common/security/password.constants';

loadEnv({ path: resolve(__dirname, '../../../.env') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set — copy .env.example to .env first.');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const CATEGORIES = [
  { slug: 'phishing', name: 'Phishing', color: '#f59e0b', sortOrder: 10 },
  { slug: 'malware', name: 'Malware', color: '#ef4444', sortOrder: 20 },
  { slug: 'ransomware', name: 'Ransomware', color: '#b91c1c', sortOrder: 30 },
  { slug: 'brute-force', name: 'Brute Force', color: '#8b5cf6', sortOrder: 40 },
  { slug: 'account-compromise', name: 'Account Compromise', color: '#ec4899', sortOrder: 50 },
  { slug: 'data-exfiltration', name: 'Data Exfiltration', color: '#0ea5e9', sortOrder: 60 },
  { slug: 'insider-threat', name: 'Insider Threat', color: '#14b8a6', sortOrder: 70 },
  { slug: 'vulnerability', name: 'Vulnerability', color: '#84cc16', sortOrder: 80 },
  { slug: 'policy-violation', name: 'Policy Violation', color: '#64748b', sortOrder: 90 },
  { slug: 'dos', name: 'Denial of Service', color: '#f97316', sortOrder: 100 },
  { slug: 'other', name: 'Other', color: '#6b7280', sortOrder: 999 },
];

/** First response / resolution targets in minutes (see PLAN.md §15 Q6). */
const SLA_POLICIES = [
  { severity: Severity.CRITICAL, firstResponseMinutes: 60, resolutionMinutes: 240 },
  { severity: Severity.HIGH, firstResponseMinutes: 240, resolutionMinutes: 1_440 },
  { severity: Severity.MEDIUM, firstResponseMinutes: 480, resolutionMinutes: 4_320 },
  { severity: Severity.LOW, firstResponseMinutes: 1_440, resolutionMinutes: 10_080 },
];

/**
 * Starting point only — the real internal ranges are maintained by admins in
 * Admin → Settings → Correlation Whitelist, not in code.
 */
const WHITELIST_DEFAULTS = [
  { type: ObservableType.IP, pattern: '10.0.0.0/8', isCidr: true, reason: 'RFC1918 private range' },
  {
    type: ObservableType.IP,
    pattern: '172.16.0.0/12',
    isCidr: true,
    reason: 'RFC1918 private range',
  },
  {
    type: ObservableType.IP,
    pattern: '192.168.0.0/16',
    isCidr: true,
    reason: 'RFC1918 private range',
  },
  { type: ObservableType.IP, pattern: '127.0.0.0/8', isCidr: true, reason: 'Loopback' },
  { type: ObservableType.IP, pattern: '169.254.0.0/16', isCidr: true, reason: 'Link-local' },
];

async function seedAdmin(): Promise<void> {
  const username = (process.env.SEED_ADMIN_USERNAME ?? 'admin').toLowerCase();
  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@blackticket.local').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    console.log(`  admin user "${username}" already exists — left untouched`);
    return;
  }

  if (!password || password.length < 12) {
    throw new Error(
      'SEED_ADMIN_PASSWORD must be set to at least 12 characters before seeding the admin account.',
    );
  }

  const passwordHash = await hash(password, ARGON2_OPTIONS);

  const admin = await prisma.user.create({
    data: {
      username,
      email,
      fullName: 'System Administrator',
      passwordHash,
      role: 'ADMIN',
      status: 'ACTIVE',
      // Forces a rotation away from the bootstrap password on first login.
      mustChangePassword: true,
    },
  });

  // Seeded into history as well, so the bootstrap password cannot be "changed"
  // back to itself on first login.
  await prisma.passwordHistory.create({ data: { userId: admin.id, passwordHash } });

  console.log(`  created admin user "${username}" (password change required at first login)`);
}

/**
 * The break-glass administrator.
 *
 * Separate from the ordinary seeded admin on purpose: that one is worked with
 * every day and can be demoted, disabled or deleted like any other account.
 * This one cannot, so however badly the account screens are misused there is
 * always a way back in. Its password is set out of band and should be stored
 * wherever the organisation keeps its break-glass credentials — not in a
 * password manager somebody locks themselves out of.
 */
async function seedRecoveryAccount(): Promise<void> {
  const username = (process.env.SEED_RECOVERY_USERNAME ?? 'recovery').toLowerCase();
  const email = (process.env.SEED_RECOVERY_EMAIL ?? 'recovery@blackticket.local').toLowerCase();
  const password = process.env.SEED_RECOVERY_PASSWORD;

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    // The flag is the whole point of the account, so it is repaired if the row
    // was created before this existed, or cleared by hand.
    if (!existing.isRecoveryAccount || existing.role !== 'ADMIN') {
      await prisma.user.update({
        where: { id: existing.id },
        data: { isRecoveryAccount: true, role: 'ADMIN', status: 'ACTIVE', deletedAt: null },
      });
      console.log(`  recovery account "${username}" already existed — protection restored`);
    } else {
      console.log(`  recovery account "${username}" already exists — left untouched`);
    }
    return;
  }

  if (!password || password.length < 12) {
    // A warning rather than a failure: an existing installation should not have
    // its seed broken by this arriving, and the account is worth nothing if it
    // is created with a password nobody chose.
    console.warn(
      '  ! recovery account NOT created — set SEED_RECOVERY_PASSWORD (12+ characters) and seed again',
    );
    return;
  }

  const passwordHash = await hash(password, ARGON2_OPTIONS);

  const user = await prisma.user.create({
    data: {
      username,
      email,
      fullName: 'Recovery Administrator',
      passwordHash,
      role: 'ADMIN',
      status: 'ACTIVE',
      isRecoveryAccount: true,
      mustChangePassword: true,
    },
  });

  await prisma.passwordHistory.create({ data: { userId: user.id, passwordHash } });
  console.log(`  created recovery account "${username}" (password change required at first login)`);
}

async function main(): Promise<void> {
  console.log('Seeding Black Ticket…');

  console.log('- categories');
  for (const category of CATEGORIES) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: { name: category.name, color: category.color, sortOrder: category.sortOrder },
      create: category,
    });
  }

  console.log('- SLA policies');
  for (const policy of SLA_POLICIES) {
    await prisma.slaPolicy.upsert({
      where: { severity: policy.severity },
      update: {},
      create: policy,
    });
  }

  console.log('- correlation whitelist defaults');
  for (const entry of WHITELIST_DEFAULTS) {
    await prisma.correlationWhitelist.upsert({
      where: { type_pattern: { type: entry.type, pattern: entry.pattern } },
      update: {},
      create: entry,
    });
  }

  console.log(`- MITRE ATT&CK techniques (${MITRE_TECHNIQUES.length})`);
  for (const technique of MITRE_TECHNIQUES) {
    const url = `https://attack.mitre.org/techniques/${technique.id.replace('.', '/')}/`;
    await prisma.mitreTechnique.upsert({
      where: { id: technique.id },
      update: { name: technique.name, tactic: technique.tactic, parentId: technique.parentId, url },
      create: { ...technique, url },
    });
  }

  console.log(`- tag catalogue (${TAG_CATALOGUE.length})`);
  for (const tag of TAG_CATALOGUE) {
    await prisma.tag.upsert({
      where: { name: tag.name },
      update: { description: tag.description, color: tag.color, isSuggested: true },
      create: { ...tag, isSuggested: true },
    });
  }

  console.log(`- task playbooks (${TASK_TEMPLATES.length})`);
  for (const template of TASK_TEMPLATES) {
    const existing = await prisma.taskTemplate.findUnique({ where: { name: template.name } });
    if (existing) {
      // Playbooks are edited by administrators; re-seeding must not undo that.
      console.log(`  playbook "${template.name}" already exists — left untouched`);
      continue;
    }

    await prisma.taskTemplate.create({
      data: {
        name: template.name,
        description: template.description,
        isDefault: template.isDefault,
        matchTags: template.matchTags,
        matchCategories: template.matchCategories,
        sortOrder: template.sortOrder,
        items: {
          create: template.items.map((item, index) => ({
            title: item.title,
            prompt: item.prompt,
            sortOrder: (index + 1) * 10,
          })),
        },
      },
    });
  }

  console.log('- bootstrap admin');
  await seedAdmin();
  await seedRecoveryAccount();

  console.log('Seed complete.');
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
