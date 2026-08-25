import { useEffect, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View, Alert } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../App';
import { getSettings, saveSettings } from '../storage/settings';
import { fetchRegistration, register } from '../api/client';
import { colors } from '../theme';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Register'>;
type Route = RouteProp<RootStackParamList, 'Register'>;

/** 云端自助注册页：仅出现在云端登录语境（设置页/重登页进入），不影响纯本地模式 */
export default function RegisterScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  // 优先用进入注册页时填的地址；从重登页进入时回退到已保存地址
  const serverUrl = (route.params?.serverUrl ?? getSettings().serverUrl).replace(
    /\/+$/,
    '',
  );
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 注册口令门禁：null = 查询中（口令框先不渲染，避免闪烁），true/false = 结果
  const [inviteRequired, setInviteRequired] = useState<boolean | null>(null);

  // 服务器地址缺失时不可注册（纯本地模式不应到达本页）
  useEffect(() => {
    if (!serverUrl) {
      Alert.alert('提示', '请先在设置中填写服务器地址');
      navigation.goBack();
    }
  }, [serverUrl, navigation]);

  // 挂载时查询是否需要注册口令：查询失败按「不需要」处理（体验优先；
  // 若服务端实际开着门禁，注册请求会被 403「注册口令错误」兜底提示）
  useEffect(() => {
    let cancelled = false;
    fetchRegistration(serverUrl)
      .then((r) => {
        if (!cancelled) setInviteRequired(!!r.inviteCodeRequired);
      })
      .catch(() => {
        if (!cancelled) setInviteRequired(false);
      });
    return () => {
      cancelled = true;
    };
  }, [serverUrl]);

  async function handleRegister() {
    if (!username || !password) {
      setError('请输入用户名和密码');
      return;
    }
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const session = await register(
        serverUrl,
        username,
        password,
        confirmPassword,
        inviteCode,
      );
      await saveSettings({
        serverUrl,
        token: session.accessToken,
        username: session.user.username,
      });
      // 与登录成功后的处理路径一致：直接进入已登录状态并回到书架
      navigation.replace('Library');
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        paddingTop: 56,
        paddingHorizontal: 20,
      }}
    >
      <TouchableOpacity onPress={() => navigation.goBack()}>
        <Text style={{ color: colors.accent, fontSize: 15 }}>← 返回登录</Text>
      </TouchableOpacity>
      <Text
        style={{
          color: colors.text,
          fontSize: 22,
          fontWeight: '600',
          marginTop: 18,
          marginBottom: 4,
        }}
      >
        注册新账号
      </Text>
      <Text style={{ color: colors.textMuted, fontSize: 13, marginBottom: 20 }}>
        注册成功后自动连接云端书架
      </Text>

      <Text style={{ color: colors.text, fontSize: 15, marginBottom: 6 }}>用户名</Text>
      <TextInput
        value={username}
        onChangeText={setUsername}
        placeholder="用户名"
        placeholderTextColor="#5a534a"
        autoCapitalize="none"
        maxLength={50}
        style={{
          backgroundColor: colors.card,
          borderRadius: 6,
          paddingVertical: 10,
          paddingHorizontal: 12,
          color: colors.text,
          fontSize: 15,
          marginBottom: 12,
        }}
      />
      <Text style={{ color: colors.text, fontSize: 15, marginBottom: 6 }}>密码</Text>
      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder="至少 4 位"
        placeholderTextColor="#5a534a"
        secureTextEntry
        style={{
          backgroundColor: colors.card,
          borderRadius: 6,
          paddingVertical: 10,
          paddingHorizontal: 12,
          color: colors.text,
          fontSize: 15,
          marginBottom: 12,
        }}
      />
      <Text style={{ color: colors.text, fontSize: 15, marginBottom: 6 }}>确认密码</Text>
      <TextInput
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        placeholder="再次输入密码"
        placeholderTextColor="#5a534a"
        secureTextEntry
        style={{
          backgroundColor: colors.card,
          borderRadius: 6,
          paddingVertical: 10,
          paddingHorizontal: 12,
          color: colors.text,
          fontSize: 15,
          marginBottom: 12,
        }}
      />
      {inviteRequired === true && (
        <>
          <Text style={{ color: colors.text, fontSize: 15, marginBottom: 6 }}>注册口令</Text>
          <TextInput
            value={inviteCode}
            onChangeText={setInviteCode}
            placeholder="请输入注册口令"
            placeholderTextColor="#5a534a"
            autoCapitalize="none"
            autoCorrect={false}
            style={{
              backgroundColor: colors.card,
              borderRadius: 6,
              paddingVertical: 10,
              paddingHorizontal: 12,
              color: colors.text,
              fontSize: 15,
              marginBottom: 12,
            }}
          />
        </>
      )}
      {error && (
        <Text style={{ color: '#d98a7e', fontSize: 13, marginBottom: 12 }}>
          {error}
        </Text>
      )}
      <TouchableOpacity
        onPress={handleRegister}
        disabled={busy}
        style={{
          backgroundColor: busy ? colors.accentDark : '#537d96',
          borderRadius: 6,
          paddingVertical: 12,
          alignItems: 'center',
        }}
      >
        <Text style={{ color: colors.text, fontSize: 15 }}>
          {busy ? '注册中…' : '注册'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}