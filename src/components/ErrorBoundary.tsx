import { Component, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { palette, spacing, typography } from '../theme';

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Last line of defence against a white-screen / crash-to-home. Any render error
 * anywhere below this boundary is caught and shown as a message with a way out,
 * instead of taking the whole app down.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  handleReset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <View style={styles.container}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body}>
          The app hit an unexpected error. Please close and reopen it. If it keeps
          happening, let your administrator know.
        </Text>
        <Text style={styles.detail} numberOfLines={4}>
          {this.state.error.message}
        </Text>
        <Text accessibilityRole="button" onPress={this.handleReset} style={styles.retry}>
          Try again
        </Text>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.canvas,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: { ...typography.title, color: palette.ink, textAlign: 'center' },
  body: { ...typography.body, color: palette.muted, textAlign: 'center' },
  detail: { ...typography.caption, color: palette.faint, textAlign: 'center' },
  retry: {
    ...typography.heading,
    color: palette.brand,
    marginTop: spacing.md,
    padding: spacing.md,
  },
});
