import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { signIn } from 'aws-amplify/auth';
import { Body, Button, Display, ErrorBanner, Field, Screen } from '../../components/ui';
import { useSession } from '../../context/SessionContext';
import { toMessageKey } from '../../lib/errors';
import { palette, spacing, typography } from '../../theme';

type Props = {
  onNeedsNewPassword: (username: string) => void;
  onForgotPassword: () => void;
  notice?: string | null;
};

/**
 * The only entry point into the app. There is deliberately no sign-up path:
 * admins are created in the Cognito console, employees by their admin.
 */
export function SignInScreen({ onNeedsNewPassword, onForgotPassword, notice }: Props) {
  const { t } = useTranslation();
  const { refresh } = useSession();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    if (!username.trim()) return setError(t('validation.usernameRequired'));
    if (!password) return setError(t('validation.passwordRequired'));

    setSubmitting(true);
    setError(null);
    try {
      const result = await signIn({
        username: username.trim(),
        password,
        options: { authFlowType: 'USER_SRP_AUTH' },
      });

      if (!result.isSignedIn) {
        const step = result.nextStep.signInStep;
        // Employees are created with a temporary password and must choose
        // their own before they can use the app.
        if (step === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
          onNeedsNewPassword(username.trim());
          return;
        }
        if (step === 'RESET_PASSWORD') {
          onForgotPassword();
          return;
        }
        setError(t('errors.generic'));
        return;
      }

      await refresh({ forceTokenRefresh: true });
    } catch (caught) {
      setError(t(toMessageKey(caught)));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}
      >
        <View style={styles.header}>
          <View style={styles.logo}>
            <Text style={styles.logoMark}>A</Text>
          </View>
          <Display>{t('auth.signInTitle')}</Display>
          <Body muted>{t('auth.signInSubtitle')}</Body>
        </View>

        {notice ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        ) : null}

        <ErrorBanner message={error} />

        <View style={styles.form}>
          <Field
            label={t('auth.usernameLabel')}
            placeholder={t('auth.usernamePlaceholder')}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            returnKeyType="next"
          />
          <Field
            label={t('auth.passwordLabel')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={handleSignIn}
          />

          <Button
            label={submitting ? t('auth.signingIn') : t('auth.signIn')}
            onPress={handleSignIn}
            loading={submitting}
          />

          <Pressable
            accessibilityRole="button"
            onPress={onForgotPassword}
            style={styles.forgot}
          >
            <Text style={styles.forgotText}>{t('auth.forgotPassword')}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', gap: spacing.xl },
  header: { gap: spacing.xs, alignItems: 'flex-start' },
  logo: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: palette.brand,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  logoMark: { color: '#fff', fontSize: 28, fontWeight: '700' },
  form: { gap: spacing.lg },
  forgot: { alignSelf: 'center', padding: spacing.sm },
  forgotText: { ...typography.label, color: palette.brand },
  notice: {
    backgroundColor: palette.successSoft,
    padding: spacing.md,
    borderRadius: 12,
  },
  noticeText: { ...typography.body, color: palette.success },
});
