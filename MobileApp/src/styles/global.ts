// src/styles/global.ts
import { StyleSheet } from 'react-native';

// 定义应用的颜色主题
export const Colors = {
  primary: '#4a6fa5',
  secondary: '#166088',
  accent: '#4cb5ae',
  light: '#f8f9fa',
  dark: '#343a40',
  success: '#28a745',
  warning: '#ffc107',
  danger: '#dc3545',
  white: '#ffffff',
  gray: '#6c757d',
  lightGray: '#e9ecef',
};

// 定义字体大小和字重
export const Typography = {
  small: 12,
  regular: 14,
  medium: 16,
  large: 18,
  xlarge: 20,
  xxlarge: 24,
  bold: '700',
  normal: '400',
};

// 定义间距和尺寸
export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

// 定义边框圆角
export const BorderRadius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  circle: 50,
};

// 创建全局样式
export const GlobalStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light,
  },
  centeredContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.light,
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginVertical: Spacing.sm,
    shadowColor: Colors.dark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  button: {
    backgroundColor: Colors.primary,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: Colors.white,
    fontSize: Typography.medium,
    fontWeight: Typography.bold as any,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.lightGray,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    fontSize: Typography.medium,
    backgroundColor: Colors.white,
  },
  text: {
    fontSize: Typography.medium,
    color: Colors.dark,
  },
  title: {
    fontSize: Typography.xxlarge,
    fontWeight: Typography.bold as any,
    color: Colors.dark,
    marginBottom: Spacing.md,
  },
  subtitle: {
    fontSize: Typography.large,
    fontWeight: Typography.bold as any,
    color: Colors.gray,
    marginBottom: Spacing.sm,
  },
});

// 导出默认主题配置
export default {
  Colors,
  Typography,
  Spacing,
  BorderRadius,
  GlobalStyles,
};