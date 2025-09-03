// src/types/navigation.ts
import { StackNavigationProp } from '@react-navigation/stack';

export type RootStackParamList = {
  Login: undefined;
  Main: undefined;
  Reader: { book: Book };
};

export type MainTabParamList = {
  Library: undefined;
  Profile: undefined;
};

export interface Book {
  id: number;
  title: string;
  author?: string;
  description?: string;
  cover_image?: string;
  file_path: string;
  file_type: string;
  file_size?: number;
  upload_date?: string;
  uploader_id?: number;
  uploader_name?: string;
}

export interface User {
  id: number;
  username: string;
  isAdmin: boolean;
}

export interface LoginResponse {
  error?: string;
  token?: string;
  expiresAt?: string;
  user?: User;
}

export interface ReadingProgress {
  id: number;
  user_id: number;
  book_id: number;
  current_page: number;
  total_pages: number;
  progress_percentage: number;
  last_read: string;
}

export type LoginScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Login'>;
export type LibraryScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Reader'>;
export type ReaderScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Reader'>;
export type ProfileScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Login'>;