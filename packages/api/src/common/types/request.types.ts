import type { Request } from 'express';
import type { User } from '@prisma/client';

/** A request that has passed JwtAuthGuard and therefore carries a real user. */
export interface RequestWithUser extends Request {
  user: User;
  /** The refresh-token family the access token was issued with. */
  sessionId: string;
}
