import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../App';
import { getSettings, saveSettings } from '../storage/settings';
import { login } from '../api/client';
import { colors } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const current = getSettings();
  const [serverUrl, setServerUrl] = useState(current.serverUrl);
  // 登录后才需要用户名密码；编辑时先留空
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSaveAndLogin() {
    const url = serverUrl.trim();
    if (!url) {
      Alert.alert('提示', '服务器地址不能为空');
      return;
    }
    if (!username || !password) {
      Alert.alert('提示', '请输入用户名和密码');
      return;
    }
    setBusy(true);
    try {
      const session = await login(url, username, password);
      await saveSettings({
        serverUrl: url,
        token: session.accessToken,
        username: session.user.username,
      });
      Alert.alert('已连接', `欢迎，${session.user.username}`, [
        { text: '好', onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      Alert.alert('连接失败', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    await saveSettings({ serverUrl: '', token: '', username: null });
    Alert.alert('已断开', 'App 已切换到纯本地模式', [
      { text: '好', onPress: () => navigation.goBack() },
    ]);
  }

  const connected = Boolean(current.token);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingTop: 56, paddingHorizontal: 20, paddingBottom: 40 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 24 }}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{ color: 'colors.accent', fontSize: 15 }}>← 返回</Text>
        </TouchableOpacity>
        <Text style={{ color: 'colors.text', fontSize: 19, fontWeight: '600', marginLeft: 14 }}>
          设置
        </Text>
      </View>

      <Text style={{ color: 'colors.text', fontSize: 15, marginBottom: 6 }}>服务器地址</Text>
      <TextInput
        value={serverUrl}
        onChangeText={setServerUrl}
        placeholder="https://books.example.com"
        placeholderTextColor="#5a534a"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        style={{
          backgroundColor: 'colors.card',
          borderRadius: 6,
          paddingVertical: 10,
          paddingHorizontal: 12,
          color: 'colors.text',
          fontSize: 15,
          marginBottom: 16,
        }}
      />

      {!connected && (
        <>
          <Text style={{ color: 'colors.text', fontSize: 15, marginBottom: 6 }}>用户名</Text>
          <TextInput
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            style={{
              backgroundColor: 'colors.card',
              borderRadius: 6,
              paddingVertical: 10,
              paddingHorizontal: 12,
              color: 'colors.text',
              fontSize: 15,
              marginBottom: 16,
            }}
          />
          <Text style={{ color: 'colors.text', fontSize: 15, marginBottom: 6 }}>密码</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            style={{
              backgroundColor: 'colors.card',
              borderRadius: 6,
              paddingVertical: 10,
              paddingHorizontal: 12,
              color: 'colors.text',
              fontSize: 15,
              marginBottom: 20,
            }}
          />
          <TouchableOpacity
            onPress={handleSaveAndLogin}
            disabled={busy}
            style={{
              backgroundColor: busy ? 'colors.accentDark' : '#537d96',
              borderRadius: 6,
              paddingVertical: 12,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: 'colors.text', fontSize: 15 }}>
              {busy ? '连接中…' : '保存并登录'}
            </Text>
          </TouchableOpacity>
        </>
      )}

      {connected && (
        <>
          <Text style={{ color: '#4a6b4a', fontSize: 14, marginBottom: 20 }}>
            ✓ 已连接{current.username ? ` · ${current.username}` : ''}
          </Text>
          <TouchableOpacity
            onPress={handleDisconnect}
            style={{
              borderWidth: 1,
              borderColor: '#8b2c1f',
              borderRadius: 6,
              paddingVertical: 12,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#d98a7e', fontSize: 15 }}>断开并使用纯本地模式</Text>
          </TouchableOpacity>
        </>
      )}

      <Text style={{ color: '#5a534a', fontSize: 12, marginTop: 28, lineHeight: 18 }}>
        不配置服务器也可以正常导入并阅读本地图书。
        配置后可与网页端同步书架和阅读进度。
      </Text>
    </ScrollView>
  );
}
