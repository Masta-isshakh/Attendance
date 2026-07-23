import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import {
  Avatar,
  Body,
  Button,
  Card,
  Caption,
  Divider,
  ErrorBanner,
  Field,
  Heading,
  SuccessBanner,
  Title,
  Toggle,
} from '../../components/ui';
import { LanguagePicker } from '../../components/LanguagePicker';
import { useSession } from '../../context/SessionContext';
import { client } from '../../lib/amplify';
import { extractServerMessage, toMessageKey } from '../../lib/errors';
import { DEFAULT_RADIUS_METRES, DEFAULT_STALENESS_MINUTES } from '../../lib/geo';
import { getCurrentPosition, failureMessageKey, supportsBackgroundLocation } from '../../lib/location';
import { getImageUrl, mediaPaths, uploadImage } from '../../lib/media';
import { palette, radius, spacing, typography } from '../../theme';

export function AdminSettingsScreen() {
  const { t } = useTranslation();
  const { organization, setOrganization, signOut, username } = useSession();

  const [latitude, setLatitude] = useState(organization?.latitude?.toString() ?? '');
  const [longitude, setLongitude] = useState(organization?.longitude?.toString() ?? '');
  const [radiusMeters, setRadiusMeters] = useState(
    (organization?.radiusMeters ?? DEFAULT_RADIUS_METRES).toString(),
  );
  const [staleness, setStaleness] = useState(
    (organization?.presenceStalenessMinutes ?? DEFAULT_STALENESS_MINUTES).toString(),
  );
  const [geofenceRuleEnabled, setGeofenceRuleEnabled] = useState(
    organization?.geofenceRuleEnabled ?? true,
  );
  const [attendanceMode, setAttendanceMode] = useState<'MANUAL' | 'AUTOMATIC'>(
    (organization?.attendanceMode as 'MANUAL' | 'AUTOMATIC') ?? 'MANUAL',
  );

  const [orgName, setOrgName] = useState(organization?.name ?? '');
  const [logoUri, setLogoUri] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [savingOrg, setSavingOrg] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (organization?.logoKey) void getImageUrl(organization.logoKey).then(setLogoUrl);
  }, [organization?.logoKey]);

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

  async function saveOrganization() {
    if (!organization) return;
    const trimmed = orgName.trim();
    if (!trimmed) {
      setError(t('validation.nameRequired'));
      return;
    }

    setSavingOrg(true);
    setError(null);
    setNotice(null);
    try {
      let logoKey = organization.logoKey ?? null;
      if (logoUri) logoKey = await uploadImage(logoUri, mediaPaths.orgLogo());

      const { data: updated, errors } = await client.models.Organization.update({
        organizationId: organization.organizationId,
        name: trimmed,
        ...(logoKey ? { logoKey } : {}),
      });
      if (errors?.length || !updated) {
        throw Object.assign(new Error('org update failed'), { errors });
      }
      setOrganization(updated);
      setLogoUri(null);
      if (updated.logoKey) setLogoUrl(await getImageUrl(updated.logoKey));
      setNotice(t('admin.settingsSaved'));
    } catch (caught) {
      setError(extractServerMessage(caught) ?? t(toMessageKey(caught)));
    } finally {
      setSavingOrg(false);
    }
  }

  async function useCurrentLocation() {
    setLocating(true);
    setError(null);
    const result = await getCurrentPosition();
    setLocating(false);

    if (!result.ok) {
      setError(t(failureMessageKey(result.failure)));
      return;
    }
    setLatitude(result.coordinates.latitude.toFixed(6));
    setLongitude(result.coordinates.longitude.toFixed(6));
  }

  async function save() {
    if (!organization) return;

    const parsedLat = Number.parseFloat(latitude);
    const parsedLng = Number.parseFloat(longitude);
    const parsedRadius = Number.parseInt(radiusMeters, 10);
    const parsedStaleness = Number.parseInt(staleness, 10);

    if (
      Number.isNaN(parsedLat) ||
      Number.isNaN(parsedLng) ||
      parsedLat < -90 ||
      parsedLat > 90 ||
      parsedLng < -180 ||
      parsedLng > 180
    ) {
      setError(t('errors.invalidInput'));
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const { data: updated, errors } = await client.models.Organization.update({
        organizationId: organization.organizationId,
        latitude: parsedLat,
        longitude: parsedLng,
        radiusMeters: Number.isNaN(parsedRadius) ? DEFAULT_RADIUS_METRES : parsedRadius,
        presenceStalenessMinutes: Number.isNaN(parsedStaleness)
          ? DEFAULT_STALENESS_MINUTES
          : parsedStaleness,
        geofenceRuleEnabled,
        attendanceMode,
      });
      // A failed write returns { data: null, errors } instead of throwing —
      // reporting success here would tell the admin their geofence was saved
      // when it was not.
      if (errors?.length || !updated) {
        throw Object.assign(new Error('organization update failed'), { errors });
      }

      setOrganization(updated);
      setNotice(t('admin.settingsSaved'));
    } catch (caught) {
      setError(extractServerMessage(caught) ?? t(toMessageKey(caught)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Title>{t('admin.settings')}</Title>

        <ErrorBanner message={error} />
        <SuccessBanner message={notice} />

        <Card>
          <Heading>{t('admin.organizationDetails')}</Heading>
          <View style={styles.logoRow}>
            <Avatar uri={logoUrl} name={orgName} size={64} />
            <Pressable accessibilityRole="button" onPress={pickLogo} style={styles.logoPick}>
              <Ionicons name="image-outline" size={18} color={palette.brand} />
              <Text style={styles.logoPickText}>
                {logoUri
                  ? t('org.changeLogo')
                  : organization?.logoKey
                    ? t('org.changeLogo')
                    : t('org.addLogo')}
              </Text>
            </Pressable>
          </View>
          {logoUri ? <Caption>{t('org.logoLabel')}</Caption> : null}
          <Field
            label={t('org.nameLabel')}
            value={orgName}
            onChangeText={setOrgName}
            autoCapitalize="words"
            placeholder={t('org.namePlaceholder')}
          />
          <Caption>{username}</Caption>
          <Button
            label={savingOrg ? t('common.saving') : t('common.save')}
            onPress={saveOrganization}
            loading={savingOrg}
          />
        </Card>

        <Card>
          <Heading>{t('admin.companyLocation')}</Heading>
          <Body muted>{t('admin.companyLocationBody')}</Body>

          <Button
            label={t('admin.useCurrentLocation')}
            onPress={useCurrentLocation}
            variant="secondary"
            icon="locate"
            loading={locating}
          />

          <View style={styles.row}>
            <View style={styles.half}>
              <Field
                label={t('admin.latitude')}
                value={latitude}
                onChangeText={setLatitude}
                keyboardType="numbers-and-punctuation"
                placeholder="19.076090"
              />
            </View>
            <View style={styles.half}>
              <Field
                label={t('admin.longitude')}
                value={longitude}
                onChangeText={setLongitude}
                keyboardType="numbers-and-punctuation"
                placeholder="72.877426"
              />
            </View>
          </View>

          <Field
            label={t('admin.radius')}
            value={radiusMeters}
            onChangeText={setRadiusMeters}
            keyboardType="number-pad"
          />
        </Card>

        <Card>
          <Heading>{t('admin.geofenceRule')}</Heading>
          <Toggle
            label={t('admin.geofenceRule')}
            description={
              geofenceRuleEnabled ? t('admin.geofenceRuleOn') : t('admin.geofenceRuleOff')
            }
            value={geofenceRuleEnabled}
            onChange={setGeofenceRuleEnabled}
          />
          <Divider />
          <Field
            label={t('admin.presenceWindow')}
            hint={t('admin.presenceWindowHint')}
            value={staleness}
            onChangeText={setStaleness}
            keyboardType="number-pad"
          />
        </Card>

        <Card>
          <Heading>{t('admin.attendanceMode')}</Heading>
          <ModeOption
            selected={attendanceMode === 'MANUAL'}
            title={t('admin.attendanceModeManual')}
            body={t('admin.attendanceModeManualBody')}
            onPress={() => setAttendanceMode('MANUAL')}
          />
          <ModeOption
            selected={attendanceMode === 'AUTOMATIC'}
            title={t('admin.attendanceModeAutomatic')}
            body={t('admin.attendanceModeAutomaticBody')}
            onPress={() => setAttendanceMode('AUTOMATIC')}
          />
          {!supportsBackgroundLocation ? (
            <View style={styles.platformNote}>
              <Ionicons name="information-circle-outline" size={16} color={palette.warning} />
              <Caption>{t('admin.attendanceModeAutomaticNative')}</Caption>
            </View>
          ) : null}
        </Card>

        <Button label={saving ? t('common.saving') : t('common.save')} onPress={save} loading={saving} />

        <LanguagePicker />

        <Button label={t('auth.signOut')} onPress={() => void signOut()} variant="ghost" />
      </ScrollView>
    </SafeAreaView>
  );
}

function ModeOption({
  selected,
  title,
  body,
  onPress,
}: {
  selected: boolean;
  title: string;
  body: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.option, selected && styles.optionSelected]}
    >
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected ? <View style={styles.radioDot} /> : null}
      </View>
      <View style={styles.optionText}>
        <Text style={styles.optionTitle}>{title}</Text>
        <Caption>{body}</Caption>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.canvas },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxxl },
  row: { flexDirection: 'row', gap: spacing.md },
  half: { flex: 1 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  logoPick: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  logoPickText: { ...typography.label, color: palette.brand },
  option: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.line,
    alignItems: 'flex-start',
  },
  optionSelected: { borderColor: palette.brand, backgroundColor: palette.brandSoft },
  optionText: { flex: 1, gap: 2 },
  optionTitle: { ...typography.heading, color: palette.ink },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: palette.faint,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  radioSelected: { borderColor: palette.brand },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: palette.brand },
  platformNote: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: palette.warningSoft,
    padding: spacing.md,
    borderRadius: radius.md,
  },
});
