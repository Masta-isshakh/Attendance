import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { confirmResetPassword, resetPassword } from 'aws-amplify/auth';
import { Body, Button, Display, ErrorBanner, Field, Screen } from '../../components/ui';
import { toMessageKey } from '../../lib/errors';
import {
  validateEmail,
  validatePassword,
  validatePasswordConfirmation,
} from '../../lib/validation';
import { spacing } from '../../theme';

type Step = 'REQUEST' | 'CODE' | 'PASSWORD';

/**
 * Three discrete steps, in this order:
 *   1. email            -> Cognito emails a verification code
 *   2. code (one field) -> verified locally, then
 *   3. new password + confirmation
 * On success the caller returns to sign-in with a confirmation notice.
 */
export function ResetPasswordScreen({
  onDone,
  onCancel,
}: {
  onDone: (notice: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();

  const [step, setStep] = useState<Step>('REQUEST');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');

  const [fieldError, setFieldError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function requestCode() {
    const emailError = validateEmail(email);
    setFieldError(emailError ? t(emailError) : null);
    if (emailError) return;

    setSubmitting(true);
    setError(null);
    try {
      await resetPassword({ username: email.trim().toLowerCase() });
      setStep('CODE');
    } catch (caught) {
      setError(t(toMessageKey(caught)));
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Cognito has no "verify code" call on its own — the code is checked as part
   * of confirmResetPassword. Advancing locally keeps the flow the user asked
   * for (one field for the code, then the password form); a wrong code surfaces
   * on the final step and sends them back here.
   */
  function submitCode() {
    if (!code.trim()) {
      setFieldError(t('validation.codeRequired'));
      return;
    }
    setFieldError(null);
    setError(null);
    setStep('PASSWORD');
  }

  async function submitNewPassword() {
    const passwordError = validatePassword(password);
    const confirmationError = validatePasswordConfirmation(password, confirmation);
    setFieldError(passwordError ? t(passwordError) : null);
    setConfirmError(confirmationError ? t(confirmationError) : null);
    if (passwordError || confirmationError) return;

    setSubmitting(true);
    setError(null);
    try {
      await confirmResetPassword({
        username: email.trim().toLowerCase(),
        confirmationCode: code.trim(),
        newPassword: password,
      });
      onDone(t('auth.passwordResetDone'));
    } catch (caught) {
      const key = toMessageKey(caught);
      setError(t(key));
      // A bad or expired code can only be discovered here, so return the user
      // to the code step rather than leaving them stuck on the password form.
      if (key === 'errors.codeMismatch' || key === 'errors.codeExpired') {
        setCode('');
        setStep('CODE');
      }
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
        {step === 'REQUEST' ? (
          <>
            <View style={styles.header}>
              <Display>{t('auth.resetTitle')}</Display>
              <Body muted>{t('auth.resetSubtitle')}</Body>
            </View>
            <ErrorBanner message={error} />
            <View style={styles.form}>
              <Field
                label={t('auth.emailLabel')}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                error={fieldError}
              />
              <Button label={t('auth.sendCode')} onPress={requestCode} loading={submitting} />
              <Button label={t('common.cancel')} onPress={onCancel} variant="ghost" />
            </View>
          </>
        ) : null}

        {step === 'CODE' ? (
          <>
            <View style={styles.header}>
              <Display>{t('auth.codeTitle')}</Display>
              <Body muted>{t('auth.codeSubtitle', { email: email.trim().toLowerCase() })}</Body>
            </View>
            <ErrorBanner message={error} />
            <View style={styles.form}>
              <Field
                label={t('auth.codeLabel')}
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                maxLength={10}
                error={fieldError}
              />
              <Button label={t('auth.verify')} onPress={submitCode} />
              <Button label={t('common.back')} onPress={() => setStep('REQUEST')} variant="ghost" />
            </View>
          </>
        ) : null}

        {step === 'PASSWORD' ? (
          <>
            <View style={styles.header}>
              <Display>{t('auth.choosePasswordTitle')}</Display>
              <Body muted>{t('auth.choosePasswordSubtitle')}</Body>
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
                error={fieldError}
              />
              <Field
                label={t('auth.confirmPassword')}
                value={confirmation}
                onChangeText={setConfirmation}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                error={confirmError}
              />
              <Button
                label={t('auth.resetPassword')}
                onPress={submitNewPassword}
                loading={submitting}
              />
              <Button
                label={t('common.back')}
                onPress={() => setStep('CODE')}
                variant="ghost"
                disabled={submitting}
              />
            </View>
          </>
        ) : null}
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', gap: spacing.xl },
  header: { gap: spacing.xs },
  form: { gap: spacing.lg },
});
