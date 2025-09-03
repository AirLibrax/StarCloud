// src/components/TabBarIcon.tsx
import React from 'react';
import Icon from 'react-native-vector-icons/Ionicons';

interface TabBarIconProps {
  focused: boolean;
  color: string;
  size: number;
  routeName: string;
}

const TabBarIcon: React.FC<TabBarIconProps> = ({ focused, color, size, routeName }) => {
  let iconName: string = '';

  if (routeName === 'Library') {
    iconName = focused ? 'library' : 'library-outline';
  } else if (routeName === 'Profile') {
    iconName = focused ? 'person' : 'person-outline';
  }

  return <Icon name={iconName} size={size} color={color} />;
};

export default TabBarIcon;