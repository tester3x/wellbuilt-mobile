import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

type Props = { children: ReactNode; label?: string };
type State = { code: string | null };

/**
 * Route-level boundary so a tab init throw cannot kill the process
 * without a recoverable surface. No secrets in the displayed code.
 */
export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { code: null };

  static getDerivedStateFromError(error: Error): State {
    const name = error?.name || 'Error';
    return { code: name.replace(/[^A-Za-z0-9_]/g, '').slice(0, 40) || 'Error' };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const msg = String(error?.message || '').slice(0, 120);
    if (/token|passcode|bearer|authorization/i.test(msg)) {
      console.log(`[RouteErrorBoundary:${this.props.label || 'route'}] ${error.name}`);
    } else {
      console.log(`[RouteErrorBoundary:${this.props.label || 'route'}] ${error.name} ${msg}`);
    }
    void info;
  }

  render(): ReactNode {
    if (this.state.code) {
      return (
        <View style={styles.box}>
          <Text style={styles.title}>WellBuilt hit a display error</Text>
          <Text style={styles.body}>Your data is still on this phone. Close and reopen the app.</Text>
          <Text style={styles.code}>{this.state.code}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  box: { flex: 1, backgroundColor: '#05060B', alignItems: 'center', justifyContent: 'center', padding: 32 },
  title: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  body: { color: '#9CA3AF', fontSize: 15, textAlign: 'center', marginBottom: 16 },
  code: { color: '#6B7280', fontSize: 12, fontFamily: 'monospace' },
});
