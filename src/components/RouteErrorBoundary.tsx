import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

type Props = { children: ReactNode; label?: string };
type State = {
  code: string | null;
  message: string | null;
  componentStack: string | null;
  jsStack: string | null;
};

/** Redact anything credential-shaped before a string is shown or logged. */
function redactSecrets(input: string): string {
  return input
    .replace(/eyJ[A-Za-z0-9._-]{20,}/g, '[jwt]')
    .replace(/ya29\.[A-Za-z0-9._-]+/g, '[oauth]')
    .replace(/\b[0-9a-f]{64}\b/gi, '[hash]')
    .replace(/(token|passcode|bearer|authorization|secret|password)\s*[:=]\s*\S+/gi, '$1:[redacted]');
}

/**
 * Route-level boundary so a tab init throw cannot kill the process without a
 * recoverable surface. Now captures the COMPLETE message, component stack, and
 * JS stack (redacted) — hiding only the error name made the real defect
 * impossible to locate from the device.
 */
export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { code: null, message: null, componentStack: null, jsStack: null };

  static getDerivedStateFromError(error: Error): State {
    const name = (error?.name || 'Error').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40) || 'Error';
    return {
      code: name,
      message: redactSecrets(String(error?.message || '')).slice(0, 500),
      jsStack: redactSecrets(String(error?.stack || '')).slice(0, 2000),
      componentStack: null,
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const componentStack = redactSecrets(String(info?.componentStack || '')).slice(0, 2000);
    this.setState({ componentStack });
    const label = this.props.label || 'route';
    // Full, redacted diagnostic in the device log.
    console.log(`[RouteErrorBoundary:${label}] ${error?.name}: ${redactSecrets(String(error?.message || ''))}`);
    console.log(`[RouteErrorBoundary:${label}] JS stack:\n${redactSecrets(String(error?.stack || ''))}`);
    console.log(`[RouteErrorBoundary:${label}] Component stack:${componentStack}`);
  }

  render(): ReactNode {
    if (this.state.code) {
      return (
        <ScrollView style={styles.box} contentContainerStyle={styles.content}>
          <Text style={styles.title}>WellBuilt hit a display error</Text>
          <Text style={styles.body}>Your data is still on this phone. Screenshot this and send it.</Text>
          <Text style={styles.codeLabel}>Error</Text>
          <Text style={styles.code}>{this.state.code}: {this.state.message}</Text>
          {this.state.componentStack ? (
            <>
              <Text style={styles.codeLabel}>Component stack</Text>
              <Text style={styles.code}>{this.state.componentStack}</Text>
            </>
          ) : null}
          {this.state.jsStack ? (
            <>
              <Text style={styles.codeLabel}>JS stack</Text>
              <Text style={styles.code}>{this.state.jsStack}</Text>
            </>
          ) : null}
        </ScrollView>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  content: { alignItems: 'stretch', justifyContent: 'center', padding: 24, paddingTop: 60 },
  codeLabel: { color: '#6B7280', fontSize: 11, fontWeight: '700', marginTop: 14, marginBottom: 4 },
  box: { flex: 1, backgroundColor: '#05060B', alignItems: 'center', justifyContent: 'center', padding: 32 },
  title: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  body: { color: '#9CA3AF', fontSize: 15, textAlign: 'center', marginBottom: 16 },
  code: { color: '#6B7280', fontSize: 12, fontFamily: 'monospace' },
});
