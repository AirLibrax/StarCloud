import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';

import LibraryScreen from './screens/LibraryScreen';
import SettingsScreen from './screens/SettingsScreen';
import ReaderScreen from './screens/ReaderScreen';
import LoginScreen from './screens/LoginScreen';
import { loadReadingPrefs } from './storage/reading-prefs';
import { loadSettingsCache } from './storage/settings';

export type RootStackParamList = {
  Library: undefined;
  Settings: undefined;
  Login: undefined;
  /** source: cloud 用 bookId，local 用 localId */
  Reader: {
    title: string;
    fileType: string;
    source: 'cloud' | 'local';
    bookId?: number;
    localId?: string;
    initialPercentage: number;
  };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    (async () => {
      await loadSettingsCache();
      await loadReadingPrefs();
      setBooted(true);
    })();
  }, []);

  if (!booted) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <NavigationContainer theme={DarkTheme}>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Library" component={LibraryScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen name="Reader" component={ReaderScreen} />
            <Stack.Screen name="Login" component={LoginScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
