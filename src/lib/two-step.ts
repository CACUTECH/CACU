// Two-step sign-in (Doc 16 SEC-014, Doc 10 E22 part 1): an authenticator app on top of the password. Supabase Auth
// holds the authenticator; the database refuses business data to a session that still owes the second step.
export type TwoStepStatus = { enrolled: boolean; required: boolean; level: string; satisfied: boolean; recovery_codes_left: number };

export const CODE = /^\d{6}$/;
export const RECOVERY = /^[A-Za-z0-9]{5}-?[A-Za-z0-9]{5}$/;
export const cleanCode = (value: string) => value.replace(/\s+/g, '');

/** What the app tells someone whose session may not use the business yet; null when nothing is owed. */
export function gateFor(status: TwoStepStatus | null): { title: string; text: string; href: string; action: string } | null {
  if (!status || status.satisfied) return null;
  if (status.enrolled) return { title: 'Enter your sign-in code', text: 'Your account uses two-step sign-in. Enter the 6-digit code from your authenticator app to continue.',
    href: '/login/verify', action: 'Enter code' };
  return { title: 'Set up two-step sign-in', text: "Your business's Chairman plan requires Owners and Admins to sign in with a code from an authenticator app as well as the password.",
    href: '/settings/security', action: 'Set it up' };
}

/** Recovery codes as a text file the person can keep somewhere safe. */
export function recoveryFile(codes: string[]) {
  return ['CACU recovery codes', 'Each code works once. Use one if you lose your authenticator app.', '', ...codes, ''].join('\n');
}
