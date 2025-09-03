import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../types/navigation';

interface Props {
  route: RouteProp<RootStackParamList, 'Reader'>;
}

const ReaderScreen: React.FC<Props> = ({ route }) => {
  const { book } = route.params;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{book.title}</Text>
      <Text style={styles.author}>{book.author || '未知作者'}</Text>
      <Text style={styles.content}>
        这里是书籍内容预览。在实际应用中，您需要根据书籍格式(PDF/EPUB/TXT)使用相应的阅读器组件。
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
  },
  author: {
    fontSize: 16,
    color: '#666',
    marginBottom: 20,
    textAlign: 'center',
  },
  content: {
    fontSize: 16,
    lineHeight: 24,
  },
});

export default ReaderScreen;