import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  Body,
  Button,
  Card,
  ErrorBanner,
  Field,
  Screen,
  Title,
} from '../../components/ui';
import { useSession } from '../../context/SessionContext';
import { client, type EmployeeRecord } from '../../lib/amplify';
import { extractServerMessage, toMessageKey } from '../../lib/errors';
import {
  generateTemporaryPassword,
  validateEmail,
  validatePassword,
  validatePhone,
  validateUsername,
} from '../../lib/validation';
import { palette, spacing, typography } from '../../theme';

/**
 * Create or edit an employee.
 *
 * On create the Lambda provisions the Cognito account (which emails the
 * username + temporary password) and only then is the Employee record written,
 * so a failed account creation never leaves a phantom employee in the roster.
 */
export function EmployeeFormScreen({
  employee,
  onClose,
  onSaved,
}: {
  employee: EmployeeRecord | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { t } = useTranslation();
  const { organization } = useSession();
  const isEditing = Boolean(employee);

  const [fullName, setFullName] = useState(employee?.fullName ?? '');
  const [username, setUsername] = useState(employee?.username ?? '');
  const [email, setEmail] = useState(employee?.email ?? '');
  const [phone, setPhone] = useState(employee?.phoneNumber ?? '');
  const [password, setPassword] = useState(() =>
    employee ? '' : generateTemporaryPassword(),
  );

  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function validate(): boolean {
    const next: Record<string, string | undefined> = {};

    const usernameError = isEditing ? null : validateUsername(username);
    const emailError = validateEmail(email);
    const phoneError = validatePhone(phone);
    const passwordError = isEditing ? null : validatePassword(password);

    if (usernameError) next.username = t(usernameError);
    if (emailError) next.email = t(emailError);
    if (phoneError) next.phone = t(phoneError);
    if (passwordError) next.password = t(passwordError);

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit() {
    if (!organization || !validate()) return;

    setSubmitting(true);
    setError(null);
    try {
      if (isEditing && employee) {
        const { errors: mutationErrors } = await client.mutations.updateEmployeeAccount({
          organizationId: organization.organizationId,
          username: employee.username,
          email: email.trim().toLowerCase(),
          phoneNumber: phone.trim() || undefined,
        });
        if (mutationErrors?.length) {
          throw Object.assign(new Error('update failed'), { errors: mutationErrors });
        }

        await client.models.Employee.update({
          id: employee.id,
          email: email.trim().toLowerCase(),
          phoneNumber: phone.trim() || null,
          fullName: fullName.trim() || null,
        });

        onSaved(t('admin.employeeUpdated'));
        return;
      }

      const { data: account, errors: mutationErrors } =
        await client.mutations.createEmployeeAccount({
          organizationId: organization.organizationId,
          username: username.trim(),
          email: email.trim().toLowerCase(),
          phoneNumber: phone.trim() || undefined,
          temporaryPassword: password,
        });

      if (mutationErrors?.length || !account) {
        throw Object.assign(new Error('create failed'), { errors: mutationErrors });
      }

      const { data: record, errors: recordErrors } = await client.models.Employee.create({
        organizationId: organization.organizationId,
        memberGroup: organization.memberGroup,
        adminGroup: organization.adminGroup,
        userId: account.userId ?? '',
        username: username.trim(),
        email: email.trim().toLowerCase(),
        phoneNumber: phone.trim() || null,
        fullName: fullName.trim() || null,
        hasCompletedFirstLogin: false,
        status: 'INACTIVE',
        isCheckedIn: false,
        disabled: false,
      });

      // The Cognito account already exists at this point. If the record write
      // failed, reporting success would leave an invisible orphan account the
      // admin cannot see or delete — so roll the account back instead.
      if (recordErrors?.length || !record) {
        await client.mutations
          .deleteEmployeeAccount({
            organizationId: organization.organizationId,
            username: username.trim(),
          })
          .catch(() => undefined);
        throw Object.assign(new Error('employee record failed'), { errors: recordErrors });
      }

      onSaved(t('admin.employeeCreated'));
    } catch (caught) {
      setError(extractServerMessage(caught) ?? t(toMessageKey(caught)));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen scroll edges={['top']}>
      <Title>{isEditing ? t('admin.editEmployee') : t('admin.newEmployee')}</Title>

      <ErrorBanner message={error} />

      <Card>
        <Field
          label={t('admin.employeeFullName')}
          value={fullName}
          onChangeText={setFullName}
          autoCapitalize="words"
          placeholder="Jane Doe"
        />
        <Field
          label={t('admin.employeeUsername')}
          hint={t('admin.employeeUsernameHint')}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isEditing}
          error={errors.username}
          placeholder="jane.doe"
        />
        <Field
          label={t('admin.employeeEmail')}
          hint={t('admin.employeeEmailHint')}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          error={errors.email}
        />
        <Field
          label={t('admin.employeePhone')}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          error={errors.phone}
          placeholder="+14155552671"
        />

        {!isEditing ? (
          <View style={styles.passwordBlock}>
            <Field
              label={t('admin.temporaryPassword')}
              hint={t('admin.temporaryPasswordHint')}
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
              autoCorrect={false}
              error={errors.password}
            />
            <Pressable onPress={() => setPassword(generateTemporaryPassword())}>
              <Text style={styles.generate}>{t('admin.generatePassword')}</Text>
            </Pressable>
          </View>
        ) : null}
      </Card>

      {!isEditing ? (
        <Body muted>{t('admin.employeeEmailHint')}</Body>
      ) : null}

      <View style={styles.actions}>
        <Button
          label={
            submitting
              ? t('admin.creatingEmployee')
              : isEditing
                ? t('common.save')
                : t('admin.createEmployee')
          }
          onPress={handleSubmit}
          loading={submitting}
        />
        <Button label={t('common.cancel')} onPress={onClose} variant="ghost" disabled={submitting} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  passwordBlock: { gap: spacing.xs },
  generate: { ...typography.label, color: palette.brand, alignSelf: 'flex-start' },
  actions: { gap: spacing.sm },
});
