import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';

import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { I18nextProvider } from 'react-i18next';

import { isBackendConfigured } from './src/lib/amplify';
import i18n, { restoreSavedLanguage } from './src/i18n';
import { SessionProvider } from './src/context/SessionContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { Body, Display, LoadingScreen, Screen } from './src/components/ui';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { palette, spacing } from './src/theme';

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

  useEffect(() => {
    void restoreSavedLanguage().finally(() => setReady(true));
  }, []);

  return (
    <SafeAreaProvider>
      <I18nextProvider i18n={i18n}>
        <StatusBar style="dark" />
        {!ready ? (
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
});
