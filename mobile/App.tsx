import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { setupDatabase } from './src/database/schema';
import { ReadingScreen } from './src/screens';

export default function App() {
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
      <StatusBar style="light" />
      <ReadingScreen />
    </GestureHandlerRootView>
  );
}

