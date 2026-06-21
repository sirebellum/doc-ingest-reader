import React, { useEffect } from 'react';
import { View, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { setupDatabase } from './src/native/DbsBridge';

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
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Text>Doc Ingest Reader</Text>
      </View>
    </GestureHandlerRootView>
  );
}
