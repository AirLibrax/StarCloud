import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// 导入组件
import LoginScreen from './src/screens/LoginScreen';
import ReaderScreen from './src/screens/ReaderScreen';
import MainTabNavigator from './src/components/MainTabNavigator';

// 导入类型
import { RootStackParamList } from './src/types/navigation';

// 创建导航器
const Stack = createStackNavigator<RootStackParamList>();

// 主应用组件
export default function App() {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [userToken, setUserToken] = useState<string | null>(null);

  useEffect(() => {
    // 检查本地存储中的认证令牌
    const bootstrapAsync = async () => {
      let token: string | null = null;
      try {
        token = await AsyncStorage.getItem('userToken');
      } catch (e) {
        console.error('Failed to restore token', e);
      }
      setUserToken(token);
      setIsLoading(false);
    };

    bootstrapAsync();
  }, []);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4a6fa5" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator>
        {userToken == null ? (
          // 未认证用户，显示登录屏幕
          <Stack.Screen 
            name="Login" 
            component={LoginScreen} 
            options={{ headerShown: false }}
          />
        ) : (
          // 已认证用户，显示主应用
          <>
            <Stack.Screen 
              name="Main" 
              component={MainTabNavigator} 
              options={{ headerShown: false }}
            />
            <Stack.Screen 
              name="Reader" 
              component={ReaderScreen} 
              options={{ title: '阅读器' }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

// 使用 StyleSheet 创建样式对象
const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});