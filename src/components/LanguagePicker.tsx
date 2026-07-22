import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Card, Heading } from './ui';
import { getStoredLanguage, setLanguage, type SupportedLanguage } from '../i18n';
import { palette, spacing, typography } from '../theme';

type Choice = SupportedLanguage | 'system';

export function LanguagePicker() {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Choice>('system');

  useEffect(() => {
    void getStoredLanguage().then(setSelected);
  }, []);

  async function choose(choice: Choice) {
    setSelected(choice);
    await setLanguage(choice);
  }

  const options: Array<{ value: Choice; label: string }> = [
    { value: 'system', label: t('language.systemDefault') },
    { value: 'en', label: t('language.english') },
    { value: 'fr', label: t('language.french') },
  ];

  return (
    <Card>
      <Heading>{t('language.title')}</Heading>
      {options.map((option) => (
        <Pressable
          key={option.value}
          accessibilityRole="radio"
          accessibilityState={{ selected: selected === option.value }}
          onPress={() => void choose(option.value)}
          style={styles.row}
        >
          <Text style={styles.label}>{option.label}</Text>
          {selected === option.value ? (
            <Ionicons name="checkmark" size={20} color={palette.brand} />
          ) : (
            <View style={styles.spacer} />
          )}
        </Pressable>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  label: { ...typography.body, color: palette.ink },
  spacer: { width: 20 },
});
