import { Card } from '@/components/ui';

const PROSE = 'space-y-3 text-sm text-[var(--color-content-muted)]';
/** Terms the surrounding screen also uses, lifted out of the grey. */
function Term({ children }: { children: string }) {
  return <span className="text-[var(--color-content)]">{children}</span>;
}

/**
 * The reference column for the single sign-on screen.
 *
 * Written for the person setting it up for the first time, so it explains the
 * decisions the screen cannot: what stays true when SSO is off, why the
 * break-glass account exists, and what the directory is and is not allowed to
 * do once it is connected.
 */
export function SsoDocsCards() {
  return (
    <>
      <Card title="How single sign-on works">
        <div className={PROSE}>
          <p>
            Single sign-on is a feature you switch on, not a mode this product ships in. While it is
            off, nothing on this screen affects anything: people sign in with local accounts exactly
            as before, and every other screen behaves identically.
          </p>
          <p>
            When it is on, the sign-in page sends the browser to your identity provider. The
            provider hands the person back, and this system issues its own session from that. Every
            guard, every permission and every audit entry works the same way afterwards — the
            provider decides <Term>who you are</Term>, this system still decides{' '}
            <Term>what you may do</Term>.
          </p>
          <p>
            Setting the provider up does not turn it on. Save the settings, run{' '}
            <Term>Test connection</Term>, then use the switch at the bottom.
          </p>
        </div>
      </Card>

      <Card title="The break-glass account">
        <div className={PROSE}>
          <p>
            With single sign-on on, only the recovery account can still sign in with a local
            password. Everyone else goes through the provider.
          </p>
          <p>
            That one exception is the reason this screen refuses to enable single sign-on until a
            recovery account exists. A wrong issuer, an expired client secret or an outage at the
            provider would otherwise leave nobody able to sign in — and nobody able to undo it.
          </p>
          <p>
            Keep its password somewhere your team can reach without this system. Unlocking the
            organisation domain also asks for it.
          </p>
        </div>
      </Card>

      <Card title="How people get accounts">
        <div className={PROSE}>
          <p>
            An account appears the first time someone signs in successfully — you do not create them
            here in advance. Their name and address are refreshed from the directory on every
            sign-in afterwards.
          </p>
          <p>
            Their role comes from <Term>Role mapping</Term> below: the first directory group they
            belong to wins. Somebody in none of the mapped groups gets whatever{' '}
            <Term>Unmapped users</Term> says — and the safe default there is to refuse the sign-in,
            because a group being renamed should not quietly hand out access.
          </p>
          <p>
            The organisation domain still applies. Someone the directory vouches for whose address
            sits outside a locked domain is refused, and the reason is written to the audit trail.
          </p>
        </div>
      </Card>

      <Card title="What the directory cannot do">
        <div className={PROSE}>
          <p>
            The directory is the source of truth about people, not a licence to overwrite decisions
            made here. Three things it can never change:
          </p>
          <p>
            It cannot take the <Term>recovery account</Term>, cannot demote or deactivate the{' '}
            <Term>last administrator</Term>, and cannot bring back an account somebody disabled in
            Black Ticket — a person who is still listed in HR but was switched off here stays off.
          </p>
          <p>
            Each of those would be a way for a change in another system to lock this one, so they
            are refused outright rather than weighed against how the tenant happens to be set up
            today.
          </p>
        </div>
      </Card>

      <Card title="Automatic account sync (SCIM)">
        <div className={PROSE}>
          <p>
            Sign-in alone creates accounts but never removes them: someone who leaves simply stops
            signing in, and their account sits there. SCIM closes that gap by letting the directory
            push changes as they happen.
          </p>
          <p>
            Point your provider at <Term>/api/v1/scim/v2</Term> and give it an API key with the{' '}
            <Term>directory sync</Term> purpose, created on the API keys screen. Send it as the
            secret token.
          </p>
          <p>
            When someone leaves, the directory marks them inactive and this system disables the
            account and ends its sessions. It never deletes: cases record who reported and who owned
            them, and removing the person would orphan that history.
          </p>
        </div>
      </Card>
    </>
  );
}
