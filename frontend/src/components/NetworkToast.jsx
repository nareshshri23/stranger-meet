import React from 'react';
import { Wifi, WifiOff, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';

export default function NetworkToast({ toast }) {
  if (!toast || !toast.message) return null;

  const { type = 'info', message } = toast;

  const bgStyles = {
    warning: 'bg-amber-950/90 border-amber-500/50 text-amber-200 shadow-amber-950/50',
    error: 'bg-red-950/90 border-red-500/50 text-red-200 shadow-red-950/50',
    success: 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200 shadow-emerald-950/50',
    info: 'bg-neutral-900/90 border-neutral-700/50 text-neutral-200 shadow-black/50'
  }[type] || 'bg-neutral-900/90 border-neutral-700 text-neutral-200';

  return (
    <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 pointer-events-none transition-all duration-300 animate-in fade-in slide-in-from-top-4">
      <div className={`flex items-center gap-2.5 px-4 py-2 rounded-full border backdrop-blur-md shadow-xl text-xs md:text-sm font-medium ${bgStyles}`}>
        {type === 'warning' && <RefreshCw className="w-4 h-4 text-amber-400 animate-spin shrink-0" />}
        {type === 'error' && <WifiOff className="w-4 h-4 text-red-400 shrink-0" />}
        {type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
        {type === 'info' && <Wifi className="w-4 h-4 text-blue-400 shrink-0" />}
        <span>{message}</span>
      </div>
    </div>
  );
}
