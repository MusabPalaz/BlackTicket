import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { generateSecret, generateURI, verifySync } from 'otplib';
import { randomBytes } from 'node:crypto';
import { BRANDING } from '@black-ticket/shared';
import { ARGON2_OPTIONS } from '../../common/security/password.constants';
import { decryptSecret, encryptSecret } from '../../common/security/secret-box';
import type { AppEnv } from '../../common/config/env.config';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * One 30-second step of tolerance on each side: enough for the clock drift of a
 * phone, short enough that a shoulder-surfed code expires quickly.
 */
const EPOCH_TOLERANCE_SECONDS = 30;

const RECOVERY_CODE_COUNT = 10;

export interface TotpSetup {
  /** Shown once so the user can type it into their authenticator app. */
  secret: string;
  /** otpauth:// URI for QR rendering. */
  uri: string;
}

@Injectable()
export class TotpService {
  constructor(
    private readonly config: ConfigService<AppEnv, true>,
    private readonly prisma: PrismaService,
  ) {}

  private get masterKey(): string {
    return this.config.get('TOTP_ENCRYPTION_KEY', { infer: true });
  }

  /** Creates a new seed. It is not active until a valid code confirms it. */
  createSetup(username: string): TotpSetup & { encryptedSecret: string } {
    const secret = generateSecret();
    return {
      secret,
      uri: generateURI({
        strategy: 'totp',
        issuer: BRANDING.productName,
        label: username,
        secret,
      }),
      encryptedSecret: encryptSecret(secret, this.masterKey),
    };
  }

  /**
   * Checks a code and spends its time step, so the same code is refused the
   * second time it is presented. The claim is a conditional update, so two
   * requests racing with one code cannot both get through.
   */
  async consumeCode(
    user: { id: string; totpSecret: string | null; totpLastStep: number | null },
    code: string,
  ): Promise<boolean> {
    if (!user.totpSecret) return false;
    const step = this.verifyCode(user.totpSecret, code, user.totpLastStep);
    if (step === null) return false;

    const claimed = await this.prisma.user.updateMany({
      where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
      data: { totpLastStep: step },
    });
    return claimed.count === 1;
  }

  /** The time step the code belongs to, or null when it does not match. */
  private verifyCode(
    encryptedSecret: string,
    code: string,
    afterTimeStep: number | null,
  ): number | null {
    try {
      const result = verifySync({
        strategy: 'totp',
        secret: decryptSecret(encryptedSecret, this.masterKey),
        token: code.replace(/\s+/g, ''),
        epochTolerance: EPOCH_TOLERANCE_SECONDS,
        ...(afterTimeStep === null ? {} : { afterTimeStep }),
      });
      return result.valid && 'timeStep' in result ? result.timeStep : null;
    } catch {
      // A tampered or undecryptable seed reads as "wrong code", never as a 500.
      return null;
    }
  }

  /**
   * Recovery codes are shown once and stored as Argon2 hashes, exactly like
   * passwords — they are password-equivalent credentials.
   */
  async createRecoveryCodes(): Promise<{ codes: string[]; hashes: string[] }> {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
      randomBytes(5).toString('hex').toUpperCase().replace(/(.{5})/, '$1-'),
    );
    const hashes = await Promise.all(codes.map((code) => argonHash(code, ARGON2_OPTIONS)));
    return { codes, hashes };
  }

  /** Returns the index of the consumed code, or -1 when none matched. */
  async consumeRecoveryCode(hashes: string[], candidate: string): Promise<number> {
    const normalized = candidate.trim().toUpperCase();
    for (let index = 0; index < hashes.length; index += 1) {
      const stored = hashes[index];
      if (!stored) continue;
      try {
        if (await argonVerify(stored, normalized)) return index;
      } catch {
        // A corrupt entry must not abort the scan of the remaining codes.
      }
    }
    return -1;
  }
}
