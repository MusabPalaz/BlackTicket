/** One message, already rendered. */
export interface OutboundMessage {
  to: string;
  subject: string;
  text: string;
  from: string;
}

/**
 * How the application hands a message to whatever actually sends it.
 *
 * The seam exists because Microsoft 365 turns SMTP AUTH off by default: a
 * tenant there will need Microsoft Graph, and that should be a second
 * implementation rather than a rewrite of everything above this line.
 */
export interface MailTransport {
  /** Proves the credentials and the host work, without sending anything. */
  verify(): Promise<void>;
  send(message: OutboundMessage): Promise<{ messageId: string }>;
  close(): void;
}
