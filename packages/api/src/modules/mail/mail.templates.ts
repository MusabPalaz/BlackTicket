import { MailTemplate } from '@black-ticket/shared';

export interface RenderedMail {
  subject: string;
  text: string;
}

export interface TemplateContext {
  fullName: string;
  title: string;
  body: string;
  link: string | null;
  webBaseUrl: string;
}

/**
 * Plain text, on purpose.
 *
 * These messages exist to say "something needs you, here is the link". HTML
 * would add a rendering surface, a tracking temptation and a spam signal for
 * no gain — the recipient's next action is always to open the application.
 */
function shell(context: TemplateContext, lead: string): string {
  const target = context.link ? `${context.webBaseUrl}${context.link}` : context.webBaseUrl;
  return [
    `Hello ${context.fullName || 'there'},`,
    '',
    lead,
    '',
    context.body ? `${context.body}\n` : '',
    `Open it here: ${target}`,
    '',
    '--',
    'Black Ticket',
    'This is an automated message; replies are not monitored.',
  ]
    .filter((line, index, all) => !(line === '' && all[index - 1] === ''))
    .join('\n');
}

export function render(template: MailTemplate, context: TemplateContext): RenderedMail {
  switch (template) {
    case MailTemplate.CASE_ASSIGNED:
      return {
        subject: `[Black Ticket] ${context.title}`,
        text: shell(context, 'A case has been assigned to you.'),
      };

    case MailTemplate.SLA_BREACH:
      return {
        subject: `[Black Ticket] SLA breached — ${context.title}`,
        text: shell(context, 'A case you own has passed its SLA target.'),
      };

    case MailTemplate.ALERT_BACKLOG:
      return {
        subject: `[Black Ticket] Alert queue is backing up`,
        text: shell(context, 'The alert queue has grown past its threshold.'),
      };

    case MailTemplate.TEST:
      return {
        subject: '[Black Ticket] Test message',
        text: [
          'This is a test from Black Ticket.',
          '',
          'If you are reading it, the outbound mail settings work: the address,',
          'the credentials and the connection to your mail host are all correct.',
          '',
          '--',
          'Black Ticket',
        ].join('\n'),
      };
  }
}
