import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
  RefreshControl,
  ListRenderItem
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/Ionicons';
import { LibraryScreenNavigationProp, Book } from '../types/navigation';

interface Props {
  navigation: LibraryScreenNavigationProp;
}

const LibraryScreen: React.FC<Props> = ({ navigation }) => {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  useEffect(() => {
    loadBooks();
  }, []);

  const loadBooks = async (): Promise<void> => {
    try {
      const token = await AsyncStorage.getItem('userToken');
      const API_BASE_URL = 'http://192.168.1.100:3000';
      
      const response = await fetch(`${API_BASE_URL}/api/books`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      const data: Book[] = await response.json();
      setBooks(data);
    } catch (error) {
      Alert.alert('错误', '加载书籍失败');
      console.error('Error loading books:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = (): void => {
    setRefreshing(true);
    loadBooks();
  };

  const renderBookItem: ListRenderItem<Book> = ({ item }) => (
    <TouchableOpacity 
      style={styles.bookItem}
      onPress={() => navigation.navigate('Reader', { book: item })}
    >
      <View style={styles.bookCover}>
        {item.cover_image ? (
          <Image source={{ uri: item.cover_image }} style={styles.bookImage} />
        ) : (
          <Icon name="book" size={50} color="#ccc" />
        )}
      </View>
      <View style={styles.bookInfo}>
        <Text style={styles.bookTitle}>{item.title}</Text>
        <Text style={styles.bookAuthor}>{item.author || '未知作者'}</Text>
        <Text style={styles.bookType}>{item.file_type}</Text>
      </View>
      <Icon name="chevron-forward" size={20} color="#ccc" />
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#4a6fa5" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={books}
        renderItem={renderBookItem}
        keyExtractor={(item: Book) => item.id.toString()}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
          />
        }
        ListEmptyComponent={
          <View style={styles.centerContainer}>
            <Text>暂无书籍</Text>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f7f9',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bookItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  bookCover: {
    width: 60,
    height: 80,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
    borderRadius: 4,
  },
  bookImage: {
    width: 60,
    height: 80,
    borderRadius: 4,
  },
  bookInfo: {
    flex: 1,
  },
  bookTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  bookAuthor: {
    fontSize: 14,
    color: '#666',
    marginBottom: 3,
  },
  bookType: {
    fontSize: 12,
    color: '#999',
  },
});

export default LibraryScreen;