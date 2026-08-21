import { Stack } from 'expo-router';
import React from 'react';
import { RouteErrorBoundary } from '../../src/components/RouteErrorBoundary';

export default function TabsLayout() {
  return (
    <RouteErrorBoundary label="tabs">
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#05060B' },
          animation: 'none', // Disable animation for smoother swipe feel
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="history" />
      </Stack>
    </RouteErrorBoundary>
  );
}
