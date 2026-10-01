import type { SVGProps } from 'react';

/**
 * A small hand-rolled icon set.
 *
 * 24 glyphs is not worth an icon library and its bundle: these are drawn on
 * one 24-unit grid with one stroke weight, so they sit together properly —
 * which is the part most icon packs get wrong when you mix them.
 */
type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconDashboard = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </Icon>
);

export const IconCases = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
    <path d="M4 11h16" />
  </Icon>
);

export const IconAlerts = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 3 3 19h18Z" />
    <path d="M12 10v4" />
    <path d="M12 17h.01" />
  </Icon>
);

export const IconObservables = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="11" cy="11" r="6" />
    <path d="m20 20-4.5-4.5" />
  </Icon>
);

export const IconUsers = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
    <path d="M16 5.5a3 3 0 0 1 0 5.6" />
    <path d="M17.5 19a5 5 0 0 0-2-3.6" />
  </Icon>
);

export const IconPlaybook = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H18a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6.5A1.5 1.5 0 0 0 5 20.5Z" />
    <path d="m9 9 1.5 1.5L14 7" />
    <path d="M9 14h6" />
  </Icon>
);

export const IconAudit = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 3h8l4 4v14H6Z" />
    <path d="M14 3v4h4" />
    <path d="M9 12h6" />
    <path d="M9 16h4" />
  </Icon>
);

export const IconSettings = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v2.2M12 18.8V21M4.2 7.5l1.9 1.1M17.9 15.4l1.9 1.1M4.2 16.5l1.9-1.1M17.9 8.6l1.9-1.1" />
  </Icon>
);

export const IconShield = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 3 5 6v6c0 4.2 2.9 7.8 7 9 4.1-1.2 7-4.8 7-9V6Z" />
    <path d="m9 12 2 2 4-4" />
  </Icon>
);

export const IconSso = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="5" width="12" height="14" rx="2" />
    <circle cx="9" cy="10" r="2" />
    <path d="M6 16c.7-1.4 1.8-2 3-2s2.3.6 3 2" />
    <path d="M15 12h6m0 0-2.5-2.5M21 12l-2.5 2.5" />
  </Icon>
);

export const IconDatabase = (props: IconProps) => (
  <Icon {...props}>
    <ellipse cx="12" cy="6" rx="7" ry="3" />
    <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
    <path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
  </Icon>
);

export const IconKey = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8" cy="12" r="4" />
    <path d="M12 12h9" />
    <path d="M17 12v3" />
    <path d="M20 12v2" />
  </Icon>
);

export const IconDomain = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17" />
    <path d="M12 3.5c2.4 2.6 3.6 5.4 3.6 8.5s-1.2 5.9-3.6 8.5c-2.4-2.6-3.6-5.4-3.6-8.5S9.6 6.1 12 3.5Z" />
  </Icon>
);

/** A window with its side panel; the sidebar toggle. */
export const IconSidebar = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
  </Icon>
);

export const IconSearch = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.7-4.7" />
  </Icon>
);

export const IconInbox = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 13V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7" />
    <path d="M4 13h4l1.5 2.5h5L16 13h4v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
  </Icon>
);

export const IconMenu = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);

export const IconClose = (props: IconProps) => (
  <Icon {...props}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Icon>
);

export const IconCheck = (props: IconProps) => (
  <Icon {...props}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </Icon>
);

export const IconChevronRight = (props: IconProps) => (
  <Icon {...props}>
    <path d="m9 5 7 7-7 7" />
  </Icon>
);

/* --- Task status markers -------------------------------------------------
 * Drawn rather than typed as emoji: emoji render differently on every
 * platform, carry their own colour, and sit oddly on a dark surface. These
 * inherit the current colour and line weight like the rest of the set.
 */

export const IconCircle = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="8" />
  </Icon>
);

export const IconCircleDot = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3.4" fill="currentColor" stroke="none" />
  </Icon>
);

export const IconCircleCheck = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="8" />
    <path d="m8.5 12.2 2.4 2.4 4.6-5" />
  </Icon>
);

export const IconCircleSlash = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="8" />
    <path d="m8.5 15.5 7-7" />
  </Icon>
);

export const IconSend = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 12h13" />
    <path d="m12.5 6.5 6 5.5-6 5.5" />
  </Icon>
);
