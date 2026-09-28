import { createTransport, type Transporter } from 'nodemailer';
import type { SmtpConfig } from '@black-ticket/shared';
import type { MailTransport, OutboundMessage } from './mail-transport';

/**
 * SMTP, the option that works with whatever the customer already runs.
 *
 * Timeouts are set deliberately: an unreachable mail host otherwise holds a
 * socket open for the operating system's default, and the worker sending a
 * queue of notices would stall on the first bad address rather than fail it
 * and move on.
 */
export class SmtpTransport implements MailTransport {
  private readonly transporter: Transporter;

  constructor(config: SmtpConfig, password: string) {
    this.transporter = createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.username, pass: password },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  async verify(): Promise<void> {
    await this.transporter.verify();
  }

  async send(message: OutboundMessage): Promise<{ messageId: string }> {
    const result = await this.transporter.sendMail({
      from: message.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
    return { messageId: result.messageId ?? '' };
  }

  close(): void {
    this.transporter.close();
  }
}
