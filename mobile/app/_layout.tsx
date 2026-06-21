import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { setupDatabase } from '../src/native/DbsBridge';
import { DatabaseProvider } from '../src/hooks/useDatabaseSync';

export default function Layout() {
  useEffect(() => {
    try {
      setupDatabase();
      console.log('Database initialized successfully.');
    } catch (error) {
      console.error('Failed to initialize database:', error);
    }
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <DatabaseProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false }} />
      </DatabaseProvider>
    </GestureHandlerRootView>
  );
}
