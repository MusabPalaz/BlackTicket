import { Global, Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { MailWorker } from './mail.worker';

/**
 * Global because the services that produce notifications — cases, SLA, alerts
 * — all need to queue mail, and threading an import through each of their
 * modules buys nothing.
 */
@Global()
@Module({
  providers: [MailService, MailWorker],
  exports: [MailService, MailWorker],
})
export class MailModule {}
