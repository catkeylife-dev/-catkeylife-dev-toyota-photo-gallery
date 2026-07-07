import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { AuthProvider } from './context/AuthContext.tsx';
import AppErrorBoundary from './components/AppErrorBoundary.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </AuthProvider>
  </StrictMode>,
);

