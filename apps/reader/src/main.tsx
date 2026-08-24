import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';

// 注意：不使用 StrictMode。
// 开发模式的 double-effect 会把 epubjs 这类命令式渲染器创建两次，
// 销毁不彻底时两套实例互相干扰（白屏 / 卡死 / 行为随机）。
createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
