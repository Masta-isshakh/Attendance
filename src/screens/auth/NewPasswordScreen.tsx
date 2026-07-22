import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { confirmSignIn } from 'aws-amplify/auth';
import { Body, Button, Display, ErrorBanner, Field, Screen } from '../../components/ui';
import { useSession } from '../../context/SessionContext';
import { toMessageKey } from '../../lib/errors';
import { validatePassword, validatePasswordConfirmation } from '../../lib/validation';
import { spacing } from '../../theme';

/**
 * Shown when Cognito answers a sign-in with
 * CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED — i.e. the employee is still on
 * the temporary password their admin generated.
 */
export function NewPasswordScreen({ onCancel }: { onCancel: () => void }) {
  const { t } = useTranslation();
  const { refresh } = useSession();

  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirmation?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    const passwordError = validatePassword(password);
    const confirmationError = validatePasswordConfirmation(password, confirmation);
    setErrors({
      password: passwordError ? t(passwordError) : undefined,
      confirmation: confirmationError ? t(confirmationError) : undefined,
    });
    if (passwordError || confirmationError) return;

    setSubmitting(true);
    setError(null);
    try {
      const result = await confirmSignIn({ challengeResponse: password });
      if (result.isSignedIn) {
        await refresh({ forceTokenRefresh: true });
      } else {
        setError(t('errors.generic'));
      }
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
          <Display>{t('auth.newPasswordTitle')}</Display>
          <Body muted>{t('auth.newPasswordSubtitle')}</Body>
        </View>

        <ErrorBanner message={error} />

        <View style={styles.form}>
          <Field
            label={t('auth.newPassword')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            error={errors.password}
          />
          <Field
            label={t('auth.confirmPassword')}
            value={confirmation}
            onChangeText={setConfirmation}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            error={errors.confirmation}
            onSubmitEditing={handleSubmit}
          />
          <Button
            label={t('auth.setPassword')}
            onPress={handleSubmit}
            loading={submitting}
          />
          <Button label={t('common.cancel')} onPress={onCancel} variant="ghost" />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', gap: spacing.xl },
  header: { gap: spacing.xs },
  form: { gap: spacing.lg },
});
