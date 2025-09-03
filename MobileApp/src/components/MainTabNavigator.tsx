// src/components/MainTabNavigator.tsx
import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import LibraryScreen from '../screens/LibraryScreen';
import ProfileScreen from '../screens/ProfileScreen';
import TabBarIcon from './TabBarIcon';
import { MainTabParamList } from '../types/navigation';

const Tab = createBottomTabNavigator<MainTabParamList>();

// 提取屏幕选项配置到组件外部
const screenOptions = ({ route }: any) => ({
  tabBarIcon: ({ focused, color, size }: { focused: boolean; color: string; size: number }) => (
    <TabBarIcon 
      focused={focused} 
      color={color} 
      size={size} 
      routeName={route.name} 
    />
  ),
  tabBarActiveTintColor: '#4a6fa5',
  tabBarInactiveTintColor: 'gray',
});

const MainTabNavigator: React.FC = () => {
  return (
    <Tab.Navigator screenOptions={screenOptions}>
      <Tab.Screen 
        name="Library" 
        component={LibraryScreen} 
        options={{ title: '我的图书馆' }} 
      />
      <Tab.Screen 
        name="Profile" 
        component={ProfileScreen} 
        options={{ title: '个人中心' }} 
      />
    </Tab.Navigator>
  );
};

export default MainTabNavigator;