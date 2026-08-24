import { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../App';
import { getSettings, saveSettings } from '../storage/settings';
import { login } from '../api/client';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** 服务器已配置但令牌过期时的重新登录页 */
export default function LoginScreen() {
  const navigation = useNavigation<Nav>();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleLogin() {
    setBusy(true);
    setError(null);
    try {
      const { serverUrl } = getSettings();
      const session = await login(serverUrl, username, password);
      await saveSettings({
        serverUrl,
        token: session.accessToken,
        username: session.user.username,
      });
      navigation.replace('Library');
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#1c1a17', justifyContent: 'center', padding: 24 }}>
      <Text style={{ color: '#f5efe4', fontSize: 22, fontWeight: '600', marginBottom: 4 }}>
        重新登录
      </Text>
      <Text style={{ color: '#8a8072', fontSize: 13, marginBottom: 20 }}>
        访问令牌已失效，请重新登录云端书架
      </Text>
      <TextInput
        value={username}
        onChangeText={setUsername}
        placeholder="用户名"
        placeholderTextColor="#5a534a"
        autoCapitalize="none"
        style={{
          backgroundColor: '#2c2924',
          borderRadius: 6,
          paddingVertical: 10,
          paddingHorizontal: 12,
          color: '#f5efe4',
          fontSize: 15,
          marginBottom: 12,
        }}
      />
      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder="密码"
        placeholderTextColor="#5a534a"
        secureTextEntry
        style={{
          backgroundColor: '#2c2924',
          borderRadius: 6,
          paddingVertical: 10,
          paddingHorizontal: 12,
          color: '#f5efe4',
          fontSize: 15,
          marginBottom: 16,
        }}
      />
      {error && (
        <Text style={{ color: '#d98a7e', fontSize: 13, marginBottom: 12 }}>{error}</Text>
      )}
      <TouchableOpacity
        onPress={handleLogin}
        disabled={busy}
        style={{
          backgroundColor: busy ? '#3f5a70' : '#537d96',
          borderRadius: 6,
          paddingVertical: 12,
          alignItems: 'center',
        }}
      >
        <Text style={{ color: '#f5efe4', fontSize: 15 }}>{busy ? '登录中…' : '登录'}</Text>
      </TouchableOpacity>
    </View>
  );
}
