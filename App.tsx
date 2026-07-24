import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';

import { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { I18nextProvider } from 'react-i18next';

import { isBackendConfigured } from './src/lib/amplify';
import i18n, { restoreSavedLanguage } from './src/i18n';
import { SessionProvider } from './src/context/SessionContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { Body, Display, LoadingScreen, Screen } from './src/components/ui';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { subscribeToCrash } from './src/lib/crashGuard';
import { palette, spacing, typography } from './src/theme';

/**
 * Shows an uncaught JS error full-screen instead of letting the app close.
 * Doubles as a diagnostic: the message can be read and reported.
 */
function CrashScreen({ message }: { message: string }) {
  return (
    <SafeAreaView style={styles.crash} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.crashContent}>
        <Text style={styles.crashTitle}>The app hit an error</Text>
        <Text style={styles.crashBody}>
          Please screenshot this and send it. Then fully close and reopen the app.
        </Text>
        <View style={styles.crashBox}>
          <Text style={styles.crashText} selectable>
            {message}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * The product is a native iOS/Android app: check-in depends on the camera and
 * on background geofencing, neither of which a browser provides. The web bundle
 * still has to compile because Amplify Hosting builds it, so it renders a
 * pointer to the mobile app rather than a half-broken experience.
 */
function UnsupportedWeb() {
  return (
    <Screen>
      <View style={styles.web}>
        <Display>Attendance</Display>
        <Body muted>
          Please open this app on your phone. Checking in needs your camera and
          location, which are only available in the mobile app.
        </Body>
      </View>
    </Screen>
  );
}

/**
 * Rendered when `amplify_outputs.json` is still the committed placeholder, i.e.
 * the backend has never been deployed. Far clearer than letting every screen
 * fail with an Amplify configuration error.
 */
function BackendNotConfigured() {
  return (
    <Screen>
      <View style={styles.web}>
        <Display>Attendance</Display>
        <Body muted>
          The backend has not been deployed yet. Run `npx ampx sandbox` (or
          deploy the branch) to generate amplify_outputs.json, then reload.
        </Body>
      </View>
    </Screen>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [crash, setCrash] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToCrash(setCrash);
    return unsubscribe;
  }, []);

  useEffect(() => {
    restoreSavedLanguage()
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);

  return (
    <SafeAreaProvider>
      <I18nextProvider i18n={i18n}>
        <StatusBar style="dark" />
        {crash ? (
          <CrashScreen message={crash} />
        ) : !ready ? (
          <LoadingScreen />
        ) : Platform.OS === 'web' ? (
          <UnsupportedWeb />
        ) : !isBackendConfigured ? (
          <BackendNotConfigured />
        ) : (
          <ErrorBoundary>
            <SessionProvider>
              <RootNavigator />
            </SessionProvider>
          </ErrorBoundary>
        )}
      </I18nextProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  web: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: palette.canvas,
  },
  crash: { flex: 1, backgroundColor: palette.canvas },
  crashContent: { padding: spacing.xl, gap: spacing.md },
  crashTitle: { ...typography.title, color: palette.ink },
  crashBody: { ...typography.body, color: palette.muted },
  crashBox: {
    backgroundColor: palette.dangerSoft,
    borderRadius: 12,
    padding: spacing.lg,
  },
  crashText: { ...typography.caption, color: palette.danger },
});
