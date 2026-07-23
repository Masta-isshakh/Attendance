import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { fetchAuthSession, getCurrentUser, signOut as amplifySignOut } from 'aws-amplify/auth';
import { client, type EmployeeRecord, type OrganizationRecord } from '../lib/amplify';
import { listAllPages } from '../lib/attendance';

export type Role = 'ADMIN' | 'EMPLOYEE' | 'UNKNOWN';

export type SessionState = {
  status: 'loading' | 'signedOut' | 'signedIn';
  role: Role;
  username: string | null;
  userId: string | null;
  email: string | null;
  groups: string[];
  organization: OrganizationRecord | null;
  employee: EmployeeRecord | null;
  /** Admin signed in but has not created their organization yet. */
  needsOrganizationSetup: boolean;
  /** Employee signed in but has not taken their first selfie yet. */
  needsSelfieOnboarding: boolean;
  error: string | null;
};

type SessionContextValue = SessionState & {
  /**
   * In-memory, per-session. An employee who has already onboarded must pass a
   * live selfie face-match on every fresh login / app launch before reaching
   * the app. It starts false and is never persisted, so re-opening the app
   * always re-gates.
   */
  faceVerified: boolean;
  markFaceVerified: () => void;
  refresh: (options?: { forceTokenRefresh?: boolean }) => Promise<void>;
  signOut: () => Promise<void>;
  setOrganization: (organization: OrganizationRecord) => void;
  setEmployee: (employee: EmployeeRecord) => void;
};

const INITIAL: SessionState = {
  status: 'loading',
  role: 'UNKNOWN',
  username: null,
  userId: null,
  email: null,
  groups: [],
  organization: null,
  employee: null,
  needsOrganizationSetup: false,
  needsSelfieOnboarding: false,
  error: null,
};

const SessionContext = createContext<SessionContextValue | null>(null);

/** `org_<uuid>_admin` -> admin of that org. `org_<uuid>` -> member. */
function findOrganizationId(groups: string[]): string | null {
  const adminGroup = groups.find((group) => group.startsWith('org_') && group.endsWith('_admin'));
  if (adminGroup) return adminGroup.replace(/_admin$/, '');
  return groups.find((group) => group.startsWith('org_')) ?? null;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>(INITIAL);
  // Kept outside `state` so refresh() never resets it mid-session.
  const [faceVerified, setFaceVerified] = useState(false);

  const refresh = useCallback(async (options?: { forceTokenRefresh?: boolean }) => {
    // Only a genuine absence of credentials means "signed out". Data-fetch
    // failures are handled separately below — treating them as sign-out would
    // eject the user on any brief loss of connectivity, and this runs on every
    // app foreground.
    let tokens: Awaited<ReturnType<typeof fetchAuthSession>>['tokens'];
    try {
      const session = await fetchAuthSession({
        forceRefresh: options?.forceTokenRefresh ?? false,
      });
      tokens = session.tokens;
    } catch {
      setState({ ...INITIAL, status: 'signedOut' });
      return;
    }

    if (!tokens?.idToken) {
      setState({ ...INITIAL, status: 'signedOut' });
      return;
    }

    try {

      const payload = tokens.idToken.payload;
      const groups = ((payload['cognito:groups'] as string[] | undefined) ?? []).map(String);
      const email = typeof payload.email === 'string' ? payload.email : null;
      const userId = typeof payload.sub === 'string' ? payload.sub : null;

      const currentUser = await getCurrentUser();
      const username = currentUser.username;

      const isAdmin = groups.includes('ADMIN') || groups.some((g) => g.endsWith('_admin'));
      const role: Role = isAdmin ? 'ADMIN' : groups.includes('EMPLOYEE') ? 'EMPLOYEE' : 'UNKNOWN';
      const organizationId = findOrganizationId(groups);

      // No org group yet: an admin still has to run first-time setup. An
      // employee in this state was provisioned incorrectly.
      if (!organizationId) {
        setState({
          ...INITIAL,
          status: 'signedIn',
          role,
          username,
          userId,
          email,
          groups,
          needsOrganizationSetup: role === 'ADMIN',
          error: role === 'ADMIN' ? null : 'errors.noOrganization',
        });
        return;
      }

      const { data: organization } = await client.models.Organization.get({ organizationId });

      if (role === 'ADMIN') {
        setState({
          status: 'signedIn',
          role,
          username,
          userId,
          email,
          groups,
          organization: organization ?? null,
          employee: null,
          needsOrganizationSetup: !organization,
          needsSelfieOnboarding: false,
          error: null,
        });
        return;
      }

      // Employees are looked up by their Cognito sub, which never changes.
      // Paginated: `limit` is the pre-filter page size, so `limit: 1` returned
      // nothing as soon as the table held more than one row.
      const matches = await listAllPages<EmployeeRecord>((nextToken) =>
        client.models.Employee.list({
          filter: { userId: { eq: userId ?? '' } },
          limit: 200,
          nextToken,
        }),
      );
      const employee = matches[0] ?? null;

      setState({
        status: 'signedIn',
        role,
        username,
        userId,
        email,
        groups,
        organization: organization ?? null,
        employee,
        needsOrganizationSetup: false,
        needsSelfieOnboarding: Boolean(employee) && !employee?.hasCompletedFirstLogin,
        error: employee ? null : 'errors.noOrganization',
      });
    } catch {
      // The credentials are valid — only the data fetch failed (offline, API
      // hiccup). Keep the user signed in and surface a retryable error instead
      // of ejecting them from the app.
      setState((previous) => ({
        ...previous,
        status: 'signedIn',
        error: 'errors.network',
      }));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    try {
      await amplifySignOut();
    } finally {
      setState({ ...INITIAL, status: 'signedOut' });
      setFaceVerified(false);
    }
  }, []);

  const markFaceVerified = useCallback(() => setFaceVerified(true), []);

  const setOrganization = useCallback((organization: OrganizationRecord) => {
    setState((previous) => ({
      ...previous,
      organization,
      needsOrganizationSetup: false,
    }));
  }, []);

  const setEmployee = useCallback((employee: EmployeeRecord) => {
    setState((previous) => ({
      ...previous,
      employee,
      needsSelfieOnboarding: !employee.hasCompletedFirstLogin,
    }));
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      ...state,
      faceVerified,
      markFaceVerified,
      refresh,
      signOut,
      setOrganization,
      setEmployee,
    }),
    [state, faceVerified, markFaceVerified, refresh, signOut, setOrganization, setEmployee],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside a SessionProvider');
  return context;
}
