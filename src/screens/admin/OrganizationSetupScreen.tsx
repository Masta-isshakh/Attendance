import { useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import {
  Body,
  Button,
  Caption,
  Display,
  ErrorBanner,
  Field,
  Screen,
} from '../../components/ui';
import { useSession } from '../../context/SessionContext';
import { client } from '../../lib/amplify';
import { currentIdentityId } from '../../lib/attendance';
import { extractServerMessage, toMessageKey } from '../../lib/errors';
import { mediaPaths, uploadImage } from '../../lib/media';
import { DEFAULT_RADIUS_METRES, DEFAULT_STALENESS_MINUTES } from '../../lib/geo';
import { validateRequired } from '../../lib/validation';
import { palette, radius, spacing } from '../../theme';

/**
 * One-time setup the first time an admin signs in.
 *
 * Order matters: the Lambda creates the org's Cognito groups and adds the admin
 * to them, but `cognito:groups` is baked into the JWT at issue time. Without a
 * forced token refresh the very next write is denied, because the token in hand
 * still has no org group in it.
 */
export function OrganizationSetupScreen() {
  const { t } = useTranslation();
  const { refresh, username, userId, signOut } = useSession();

  const [name, setName] = useState('');
  const [logoUri, setLogoUri] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  async function pickLogo() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]) setLogoUri(result.assets[0].uri);
  }

  async function handleCreate() {
    const validationError = validateRequired(name);
    setNameError(validationError ? t(validationError) : null);
    if (validationError) return;

    setSubmitting(true);
    setError(null);
    try {
      setProgress(t('org.creating'));

      // 1. Create the Cognito groups and enrol this admin.
      const { data: provisioned, errors } = await client.mutations.provisionOrganization({});
      if (errors?.length || !provisioned) {
        throw Object.assign(new Error('provision failed'), { errors });
      }

      // 2. Pick up the new group claims before doing anything authorised by them.
      await refresh({ forceTokenRefresh: true });

      // 3. Logo upload needs the identity id, which only exists post-refresh.
      let logoKey: string | null = null;
      if (logoUri) {
        const identityId = await currentIdentityId();
        logoKey = await uploadImage(logoUri, mediaPaths.orgLogo(identityId));
      }

      // 4. Now the org record itself, which the new group grants access to.
      const { data: organization, errors: createErrors } =
        await client.models.Organization.create({
          organizationId: provisioned.organizationId,
          memberGroup: provisioned.memberGroup,
          adminGroup: provisioned.adminGroup,
          name: name.trim(),
          logoKey,
          adminUserId: userId ?? '',
          adminUsername: username ?? '',
          radiusMeters: DEFAULT_RADIUS_METRES,
          geofenceRuleEnabled: true,
          attendanceMode: 'MANUAL',
          presenceStalenessMinutes: DEFAULT_STALENESS_MINUTES,
        });

      if (createErrors?.length || !organization) {
        throw Object.assign(new Error('create failed'), { errors: createErrors });
      }

      await refresh();
    } catch (caught) {
      setError(extractServerMessage(caught) ?? t(toMessageKey(caught)));
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  }

  return (
    <Screen scroll>
      <View style={styles.header}>
        <Display>{t('org.setupTitle')}</Display>
        <Body muted>{t('org.setupSubtitle')}</Body>
      </View>

      <ErrorBanner message={error} />

      <View style={styles.form}>
        <Field
          label={t('org.nameLabel')}
          placeholder={t('org.namePlaceholder')}
          value={name}
          onChangeText={setName}
          error={nameError}
          autoCapitalize="words"
        />

        <View style={styles.logoBlock}>
          <Caption>{t('org.logoLabel')}</Caption>
          <Pressable
            accessibilityRole="button"
            onPress={pickLogo}
            style={styles.logoPicker}
            disabled={submitting}
          >
            {logoUri ? (
              <Image source={{ uri: logoUri }} style={styles.logo} />
            ) : (
              <View style={styles.logoPlaceholder}>
                <Ionicons name="image-outline" size={24} color={palette.brand} />
              </View>
            )}
            <Body muted>{logoUri ? t('org.changeLogo') : t('org.addLogo')}</Body>
          </Pressable>
        </View>

        <Button
          label={progress ?? t('org.createOrganization')}
          onPress={handleCreate}
          loading={submitting}
        />
        <Button label={t('auth.signOut')} onPress={() => void signOut()} variant="ghost" />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.xs, marginTop: spacing.xxl },
  form: { gap: spacing.lg },
  logoBlock: { gap: spacing.sm },
  logoPicker: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  logo: { width: 72, height: 72, borderRadius: radius.md },
  logoPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: radius.md,
    backgroundColor: palette.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: palette.line,
    borderStyle: 'dashed',
  },
});
