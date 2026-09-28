import { Injectable, type OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as zxcvbnCommon from '@zxcvbn-ts/language-common';
import * as zxcvbnEn from '@zxcvbn-ts/language-en';
import { PrismaService } from '../../prisma/prisma.service';
import { ARGON2_OPTIONS, MIN_PASSWORD_LENGTH, PASSWORD_HISTORY_DEPTH } from './password.constants';

/**
 * One factory for the whole process: it compiles the dictionaries once, and
 * password checks then cost microseconds instead of rebuilding the matchers on
 * every call.
 */
const zxcvbn = new ZxcvbnFactory({
  dictionary: { ...zxcvbnCommon.dictionary, ...zxcvbnEn.dictionary },
  graphs: zxcvbnCommon.adjacencyGraphs,
  // Without the translations the library returns message keys such as
  // "similarToCommon", which are useless to the person choosing a password.
  translations: zxcvbnEn.translations,
});

/**
 * The gate is the estimated number of guesses, not the 0–4 score.
 *
 * The score buckets are too coarse for a security tool: measured against this
 * very dictionary, "Summer2026!!" scores 3 (10^8 guesses) and "Admin!2026Soc"
 * scores a full 4 (10^10) — both are exactly what password spraying tries
 * first. Requiring 10^12 guesses rejects those while accepting ordinary
 * passphrases ("harbor-quartz-lantern-97" ≈ 10^19) and real random strings
 * ("kX9$mfQ2vLp8" ≈ 10^12).
 *
 * Against Argon2id at 64 MiB — a few thousand guesses per second per GPU —
 * 10^12 is on the order of years of offline cracking.
 */
const MIN_GUESSES_LOG10 = 12;

export type PasswordPolicyResult =
  | { ok: true }
  | { ok: false; message: string };

@Injectable()
export class PasswordService implements OnModuleInit {
  /**
   * Verified against when an account has no local password, so the absence of
   * one costs the same time as a wrong one.
   */
  private decoyHash = '';

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    this.decoyHash = await this.hash(randomBytes(32).toString('hex'));
  }

  hash(plain: string): Promise<string> {
    return hash(plain, ARGON2_OPTIONS);
  }

  /**
   * Argon2 verification is intentionally slow, which is also what makes it a
   * timing-safe comparison; a mismatching hash never short-circuits.
   */
  async verify(storedHash: string, plain: string): Promise<boolean> {
    try {
      return await verify(storedHash, plain);
    } catch {
      // A malformed hash in the database must read as "wrong password",
      // never as an unhandled 500 that reveals account state.
      return false;
    }
  }

  /**
   * Verification for an account that may have no local password at all.
   *
   * A provisioned account carries `passwordHash: null`. That has to fail the
   * same way, and in the same time, as a wrong password: otherwise the login
   * form answers "is this account federated?" for anyone who asks.
   */
  async verifyLocal(storedHash: string | null, plain: string): Promise<boolean> {
    if (storedHash === null) {
      await this.verify(this.decoyHash, plain);
      return false;
    }
    return this.verify(storedHash, plain);
  }

  /**
   * Strength policy. Length alone is a poor gate, so the password is also run
   * through zxcvbn with the account's own identifiers as context — "admin2026"
   * for user `admin` is long enough and still worthless.
   */
  checkStrength(password: string, context: { username?: string; email?: string; fullName?: string }): PasswordPolicyResult {
    if (password.length < MIN_PASSWORD_LENGTH) {
      return { ok: false, message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
    }

    if (password.length > 256) {
      return { ok: false, message: 'Password must be at most 256 characters.' };
    }

    const userInputs = [context.username, context.email, context.fullName]
      .filter((value): value is string => Boolean(value))
      .flatMap((value) => [value, ...value.split(/[.@\s_-]+/)])
      .filter((value) => value.length > 2);

    // Explicit identity check: an attacker who knows the account name tries it
    // first, and dictionary scoring alone does not always penalise it enough.
    const lowered = password.toLowerCase();
    for (const identifier of [context.username, context.email?.split('@')[0]]) {
      if (identifier && identifier.length > 2 && lowered.includes(identifier.toLowerCase())) {
        return { ok: false, message: 'Password must not contain the account name.' };
      }
    }

    const result = zxcvbn.check(password, userInputs);
    if (result.guessesLog10 < MIN_GUESSES_LOG10) {
      const suggestion =
        result.feedback.warning ||
        result.feedback.suggestions[0] ||
        'Four unrelated words work well, for example "harbor-quartz-lantern-97".';
      return {
        ok: false,
        message: `Password is too easy to guess. ${suggestion}`,
      };
    }

    return { ok: true };
  }

  /** Blocks reuse of the last N passwords. */
  async isReused(userId: string, password: string): Promise<boolean> {
    const history = await this.prisma.passwordHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: PASSWORD_HISTORY_DEPTH,
    });

    for (const entry of history) {
      if (await this.verify(entry.passwordHash, password)) {
        return true;
      }
    }
    return false;
  }

  /** Appends to the history ring and trims anything past the depth limit. */
  async rememberPassword(userId: string, passwordHash: string): Promise<void> {
    await this.prisma.passwordHistory.create({ data: { userId, passwordHash } });

    const stale = await this.prisma.passwordHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: PASSWORD_HISTORY_DEPTH,
      select: { id: true },
    });

    if (stale.length > 0) {
      await this.prisma.passwordHistory.deleteMany({
        where: { id: { in: stale.map((entry) => entry.id) } },
      });
    }
  }
}
