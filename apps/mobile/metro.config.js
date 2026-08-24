const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// vendor 下的 .txt 是打包用的 JS 库（epubjs / jszip），作为资源文件处理
config.resolver.assetExts.push('txt');

module.exports = config;
