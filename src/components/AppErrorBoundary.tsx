import React, { Component, ErrorInfo, ReactNode } from 'react';
import { logClientError } from '@/src/lib/clientErrorLogger';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export default class AppErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({
      error,
      errorInfo
    });

    console.error('[AppErrorBoundary] Captured unhandled React exception:', error, errorInfo);

    // Fire-and-forget logs to Firestore
    logClientError({
      source: 'AppErrorBoundary',
      stage: 'react_runtime_error',
      message: error?.message || 'Unknown react error',
      stack: error?.stack || errorInfo?.componentStack || 'No stack trace available',
      extra: {
        componentStack: errorInfo?.componentStack || ''
      }
    }).catch(err => {
      console.error('[AppErrorBoundary] Failed to log error to Firestore:', err);
    });
  }

  private handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div 
          id="error-boundary-container"
          className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-6 text-center select-none"
        >
          <div 
            id="error-boundary-card"
            className="w-full max-w-md bg-white rounded-[32px] border border-gray-100 p-8 shadow-xl flex flex-col items-center gap-6"
          >
            <div 
              id="error-boundary-icon-wrapper"
              className="w-16 h-16 bg-red-50 text-toyota-red rounded-2xl flex items-center justify-center animate-pulse"
            >
              <AlertTriangle size={32} />
            </div>

            <div id="error-boundary-text-wrapper" className="space-y-2">
              <h1 id="error-boundary-title" className="text-lg font-black text-toyota-navy uppercase tracking-tight">
                Hệ thống gặp lỗi xử lý
              </h1>
              <p id="error-boundary-desc" className="text-xs text-gray-500 font-bold leading-relaxed">
                Ứng dụng gặp lỗi khi xử lý ảnh hoặc hoạt động hệ thống. 
                <br />
                Vui lòng tải lại ứng dụng hoặc thử lại bằng Chrome mới nhất.
              </p>
            </div>

            {this.state.error && (
              <div 
                id="error-boundary-debug-log"
                className="w-full bg-gray-50 border border-gray-100 rounded-2xl p-4 text-left overflow-auto max-h-36"
              >
                <span className="block text-[9px] uppercase font-bold tracking-widest text-gray-400 mb-1">Chi tiết lỗi</span>
                <p className="text-[10px] font-mono text-red-600 font-semibold break-all whitespace-pre-wrap">
                  {this.state.error.name}: {this.state.error.message}
                </p>
              </div>
            )}

            <button
              id="error-boundary-reload-button"
              type="button"
              onClick={this.handleReload}
              className="w-full py-4 bg-toyota-red hover:bg-opacity-95 text-white font-black text-xs uppercase tracking-widest rounded-2xl shadow-lg shadow-red-500/10 hover:shadow-red-500/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <RefreshCw size={14} className="animate-spin-slow" />
              <span>Tải lại ứng dụng</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
