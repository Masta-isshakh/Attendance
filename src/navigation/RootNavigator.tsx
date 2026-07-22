import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadingScreen } from '../components/ui';
import { useSession } from '../context/SessionContext';
import { SignInScreen } from '../screens/auth/SignInScreen';
import { NewPasswordScreen } from '../screens/auth/NewPasswordScreen';
import { ResetPasswordScreen } from '../screens/auth/ResetPasswordScreen';
import { OrganizationSetupScreen } from '../screens/admin/OrganizationSetupScreen';
import { SelfieOnboardingScreen } from '../screens/employee/SelfieOnboardingScreen';
import { AdminTabs } from './AdminTabs';
import { EmployeeTabs } from './EmployeeTabs';
import { Screen, Body, Button, Display } from '../components/ui';
import { View } from 'react-native';

type AuthRoute = 'SIGN_IN' | 'NEW_PASSWORD' | 'RESET';

/**
 * Routing is driven entirely by session state rather than a navigator stack, so
 * there is never a moment where a signed-out user can navigate "back" into an
 * authenticated screen.
 */
export function RootNavigator() {
  const { t } = useTranslation();
  const session = useSession();
  const [route, setRoute] = useState<AuthRoute>('SIGN_IN');
  const [notice, setNotice] = useState<string | null>(null);

  if (session.status === 'loading') return <LoadingScreen />;

  if (session.status === 'signedOut') {
    if (route === 'NEW_PASSWORD') {
      return <NewPasswordScreen onCancel={() => setRoute('SIGN_IN')} />;
    }
    if (route === 'RESET') {
      return (
        <ResetPasswordScreen
          onCancel={() => setRoute('SIGN_IN')}
          onDone={(message) => {
            setNotice(message);
            setRoute('SIGN_IN');
          }}
        />
      );
    }
    return (
      <SignInScreen
        notice={notice}
        onNeedsNewPassword={() => {
          setNotice(null);
          setRoute('NEW_PASSWORD');
        }}
        onForgotPassword={() => {
          setNotice(null);
          setRoute('RESET');
        }}
      />
    );
  }

  if (session.role === 'ADMIN') {
    if (session.needsOrganizationSetup || !session.organization) {
      return <OrganizationSetupScreen />;
    }
    return <AdminTabs />;
  }

  if (session.role === 'EMPLOYEE') {
    // An employee with no record cannot be routed anywhere useful — this means
    // their account was provisioned incorrectly.
    if (!session.employee) {
      return (
        <Screen>
          <View style={{ flex: 1, justifyContent: 'center', gap: 12 }}>
            <Display>{t('common.appName')}</Display>
            <Body muted>{t('errors.noOrganization')}</Body>
            <Button label={t('auth.signOut')} onPress={() => void session.signOut()} />
          </View>
        </Screen>
      );
    }
    if (session.needsSelfieOnboarding) return <SelfieOnboardingScreen />;
    return <EmployeeTabs />;
  }

  // Signed in but in neither group: nothing sensible to show.
  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center', gap: 12 }}>
        <Display>{t('common.appName')}</Display>
        <Body muted>{t('errors.noOrganization')}</Body>
        <Button label={t('auth.signOut')} onPress={() => void session.signOut()} />
      </View>
    </Screen>
  );
}
