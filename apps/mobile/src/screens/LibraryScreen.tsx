import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../App';
import type { CloudShelfItem, ApiError } from '../api/client';
import { fetchShelf, fileUrl } from '../api/client';
import {
  listLocalBooks,
  importLocalBook,
  ensureCloudBookDownloaded,
  type LocalBook,
} from '../storage/local-books';
import { getSettings } from '../storage/settings';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const FILE_TYPE_COLOR: Record<string, string> = {
  pdf: '#8b5a4a',
  epub: '#537d96',
  txt: '#4a6b4a',
};

export default function LibraryScreen() {
  const navigation = useNavigation<Nav>();
  const [localBooks, setLocalBooks] = useState<LocalBook[]>([]);
  const [cloud, setCloud] = useState<CloudShelfItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const hasServer = Boolean(getSettings().serverUrl && getSettings().token);

  const reload = useCallback(async () => {
    setLocalBooks(await listLocalBooks());
    if (!hasServer) return;
    try {
      setCloud(await fetchShelf());
      setError(null);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : '云端书架加载失败';
      // 401 时引导去登录
      setError(msg);
    }
  }, [hasServer]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  async function handleImport() {
    try {
      const book = await importLocalBook();
      if (book) {
        setLocalBooks(await listLocalBooks());
        navigation.navigate('Reader', {
          title: book.volume != null ? `${book.title} 第${book.volume}卷` : book.title,
          fileType: book.fileType,
          source: 'local',
          localId: book.id,
          initialPercentage: book.progress?.percentage ?? 0,
        });
      }
    } catch (err) {
      Alert.alert('导入失败', err instanceof Error ? err.message : String(err));
    }
  }

  function openCloud(item: CloudShelfItem) {
    // 已下载到本地的云端书直接读本地副本（离线可用）
    const local = localBooks.find((b) => b.cloudBookId === item.book.id);
    if (local) {
      openLocal(local);
      return;
    }
    navigation.navigate('Reader', {
      title:
        item.book.volume != null
          ? `${item.book.title} 第${item.book.volume}卷`
          : item.book.title,
      fileType: item.book.fileType,
      source: 'cloud',
      bookId: item.book.id,
      initialPercentage: item.progress?.percentage ?? 0,
    });
  }

  async function handleDownload(item: CloudShelfItem) {
    try {
      await ensureCloudBookDownloaded({
        id: item.book.id,
        title: item.book.title,
        volume: item.book.volume,
        author: item.book.author,
        fileType: item.book.fileType,
        fileUrl: fileUrl(item.book.id),
      });
      setLocalBooks(await listLocalBooks());
      Alert.alert('已下载', `《${item.book.title}》可离线阅读`);
    } catch (err) {
      Alert.alert('下载失败', err instanceof Error ? err.message : String(err));
    }
  }

  function openLocal(book: LocalBook) {
    navigation.navigate('Reader', {
      title: book.volume != null ? `${book.title} 第${book.volume}卷` : book.title,
      fileType: book.fileType,
      source: 'local',
      localId: book.id,
      initialPercentage: book.progress?.percentage ?? 0,
    });
  }

  const sections: {
    key: string;
    title: string;
    subtitle: string;
    onPress?: () => void;
    badge?: string;
    progressText?: string;
    cloudItem?: CloudShelfItem;
    downloaded?: boolean;
  }[] = [
    {
      key: 'import',
      title: '导入本地图书',
      subtitle: 'EPUB / PDF / TXT',
      onPress: handleImport,
      badge: '+',
    },
    ...localBooks.map((b) => ({
      key: `local-${b.id}`,
      title: b.volume != null ? `${b.title} 第${b.volume}卷` : b.title,
      subtitle: b.author ?? b.fileType.toUpperCase(),
      onPress: () => openLocal(b),
      badge: b.fileType.toUpperCase(),
      progressText: b.progress ? `${b.progress.percentage}%` : undefined,
    })),
    ...(cloud ?? []).map((i) => ({
      key: `cloud-${i.book.id}`,
      title: i.book.volume != null ? `${i.book.title} 第${i.book.volume}卷` : i.book.title,
      subtitle: i.book.author ?? i.book.fileType.toUpperCase(),
      onPress: () => openCloud(i),
      badge: i.book.fileType.toUpperCase(),
      progressText: i.progress ? `${i.progress.percentage}%` : undefined,
      cloudItem: i,
      downloaded: localBooks.some((b) => b.cloudBookId === i.book.id),
    })),
  ];

  return (
    <View style={{ flex: 1, backgroundColor: '#1c1a17' }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: 56,
          paddingHorizontal: 16,
          paddingBottom: 10,
        }}
      >
        <Text style={{ color: '#f5efe4', fontSize: 22, fontWeight: '600' }}>
          星辰云图书馆
        </Text>
        <TouchableOpacity onPress={() => navigation.navigate('Settings')}>
          <Text style={{ color: '#9fb8c9', fontSize: 16 }}>设置</Text>
        </TouchableOpacity>
      </View>

      {error && (
        <Text style={{ color: '#d98a7e', fontSize: 13, paddingHorizontal: 16 }}>
          {error}
        </Text>
      )}

      <FlatList
        data={sections}
        keyExtractor={(item) => item.key}
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await reload();
              setRefreshing(false);
            }}
            tintColor="#9fb8c9"
          />
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={item.onPress}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: 14,
              paddingHorizontal: 16,
              borderBottomWidth: 0.5,
              borderBottomColor: '#3a352e',
            }}
          >
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 4,
                backgroundColor: item.badge === '+' ? '#2c2924' : FILE_TYPE_COLOR[item.badge ?? ''] ?? '#2c2924',
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: 12,
              }}
            >
              <Text style={{ color: '#f5efe4', fontSize: item.badge === '+' ? 24 : 11, fontWeight: '600' }}>
                {item.badge}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#f5efe4', fontSize: 15 }} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={{ color: '#8a8072', fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                {item.subtitle}
              </Text>
            </View>
            {item.progressText && (
              <Text style={{ color: '#8a8072', fontSize: 12, marginRight: 8 }}>
                {item.progressText}
              </Text>
            )}
            {item.cloudItem && !item.downloaded && (
              <TouchableOpacity
                onPress={() => handleDownload(item.cloudItem!)}
                style={{
                  borderWidth: 1,
                  borderColor: '#3f5a70',
                  borderRadius: 4,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                }}
              >
                <Text style={{ color: '#9fb8c9', fontSize: 12 }}>下载</Text>
              </TouchableOpacity>
            )}
            {item.cloudItem && item.downloaded && (
              <Text style={{ color: '#4a6b4a', fontSize: 12 }}>已下载</Text>
            )}
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Text style={{ color: '#8a8072', textAlign: 'center', marginTop: 48 }}>
            还没有藏书，点上面「导入」添加第一本。
          </Text>
        }
      />
    </View>
  );
}
