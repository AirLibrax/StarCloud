import { Navigate, Route, Routes } from 'react-router-dom';
import { getStoredUser, getToken } from './api/client';
import { AuthProvider } from './auth-context';
import LoginPage from './pages/LoginPage';
import ShelfPage from './pages/ShelfPage';
import ReaderPage from './pages/ReaderPage';

function AuthGate({ children }: { children: React.ReactNode }) {
  if (!getToken() || !getStoredUser()) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <AuthGate>
              <ShelfPage />
            </AuthGate>
          }
        />
        <Route
          path="/read/:bookId"
          element={
            <AuthGate>
              <ReaderPage />
            </AuthGate>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
