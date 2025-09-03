import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/Ionicons';
import { ProfileScreenNavigationProp, User } from '../types/navigation';

interface Props {
  navigation: ProfileScreenNavigationProp;
}

const ProfileScreen: React.FC<Props> = ({ navigation }) => {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    loadUserInfo();
  }, []);

  const loadUserInfo = async (): Promise<void> => {
    try {
      const userData = await AsyncStorage.getItem('user');
      if (userData) {
        setUser(JSON.parse(userData));
      }
    } catch (error) {
      console.error('Error loading user info:', error);
    }
  };

  const handleLogout = async (): Promise<void> => {
    try {
      const token = await AsyncStorage.getItem('userToken');
      const API_BASE_URL = 'http://192.168.1.100:3000';
      
      // 调用登出API
      await fetch(`${API_BASE_URL}/api/auth/logout`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      // 清除本地存储
      await AsyncStorage.removeItem('userToken');
      await AsyncStorage.removeItem('user');
      
      // 导航到登录页面
      navigation.replace('Login');
    } catch (error) {
      console.error('Logout error:', error);
      // 即使API调用失败，也清除本地存储
      await AsyncStorage.removeItem('userToken');
      await AsyncStorage.removeItem('user');
      navigation.replace('Login');
    }
  };

  const confirmLogout = (): void => {
    Alert.alert(
      '确认退出',
      '您确定要退出登录吗？',
      [
        { text: '取消', style: 'cancel' },
        { text: '确定', onPress: handleLogout }
      ]
    );
  };

  if (!user) {
    return (
      <View style={styles.container}>
        <Text>加载中...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.profileHeader}>
        <View style={styles.avatar}>
          <Icon name="person" size={50} color="#fff" />
        </View>
        <Text style={styles.username}>{user.username}</Text>
        <Text style={styles.role}>{user.isAdmin ? '管理员' : '普通用户'}</Text>
      </View>

      <View style={styles.menu}>
        <TouchableOpacity style={styles.menuItem}>
          <Icon name="bookmark" size={24} color="#4a6fa5" />
          <Text style={styles.menuText}>我的书签</Text>
          <Icon name="chevron-forward" size={20} color="#ccc" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.menuItem}>
          <Icon name="time" size={24} color="#4a6fa5" />
          <Text style={styles.menuText}>阅读历史</Text>
          <Icon name="chevron-forward" size={20} color="#ccc" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.menuItem}>
          <Icon name="settings" size={24} color="#4a6fa5" />
          <Text style={styles.menuText}>设置</Text>
          <Icon name="chevron-forward" size={20} color="#ccc" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.menuItem} onPress={confirmLogout}>
          <Icon name="log-out" size={24} color="#e74c3c" />
          <Text style={[styles.menuText, styles.logoutText]}>退出登录</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f7f9',
  },
  profileHeader: {
    alignItems: 'center',
    padding: 30,
    backgroundColor: '#fff',
    marginBottom: 10,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#4a6fa5',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 15,
  },
  username: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  role: {
    fontSize: 16,
    color: '#666',
  },
  menu: {
    backgroundColor: '#fff',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  menuText: {
    flex: 1,
    fontSize: 16,
    marginLeft: 15,
  },
  logoutText: {
    color: '#e74c3c',
  },
});

export default ProfileScreen;