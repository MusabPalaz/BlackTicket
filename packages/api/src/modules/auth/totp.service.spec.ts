import type { ConfigService } from '@nestjs/config';
import { generateSync } from 'otplib';
import { describe, expect, it } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AppEnv } from '../../common/config/env.config';
import { TotpService } from './totp.service';

const KEY = 'a-totp-encryption-key-of-32-chars-or-more';

/** One account row, with the conditional update behaving as the database would. */
function harness() {
  const row = { id: 'user-1', totpSecret: null as string | null, totpLastStep: null as number | null };
  const prisma = {
    user: {
      updateMany: async ({
        where,
        data,
      }: {
        where: { OR: [unknown, { totpLastStep: { lt: number } }] };
        data: { totpLastStep: number };
      }) => {
        const bound = where.OR[1].totpLastStep.lt;
        if (row.totpLastStep !== null && row.totpLastStep >= bound) return { count: 0 };
        row.totpLastStep = data.totpLastStep;
        return { count: 1 };
      },
    },
  };
  const config = { get: () => KEY };
  const service = new TotpService(
    config as unknown as ConfigService<AppEnv, true>,
    prisma as unknown as PrismaService,
  );
  const setup = service.createSetup('analyst');
  row.totpSecret = setup.encryptedSecret;
  return { service, row, secret: setup.secret };
}

describe('TotpService.consumeCode', () => {
  it('accepts a live code once and refuses it the second time', async () => {
    const { service, row, secret } = harness();
    const code = generateSync({ strategy: 'totp', secret });

    await expect(service.consumeCode(row, code)).resolves.toBe(true);
    expect(row.totpLastStep).not.toBeNull();
    await expect(service.consumeCode(row, code)).resolves.toBe(false);
  });

  it('refuses an earlier code once a later one has been used', async () => {
    const { service, row, secret } = harness();
    const now = Math.floor(Date.now() / 1000);
    const earlier = generateSync({ strategy: 'totp', secret, epoch: now - 30 });
    const current = generateSync({ strategy: 'totp', secret, epoch: now });

    await expect(service.consumeCode(row, current)).resolves.toBe(true);
    await expect(service.consumeCode(row, earlier)).resolves.toBe(false);
  });

  it('refuses a wrong code without spending anything', async () => {
    const { service, row } = harness();

    await expect(service.consumeCode(row, '000000')).resolves.toBe(false);
    expect(row.totpLastStep).toBeNull();
  });
});
