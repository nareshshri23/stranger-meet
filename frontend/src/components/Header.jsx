import React from 'react';
import { LogOut } from 'lucide-react';

export default function Header({ user, onLogout, onNext, socketReady, matchStatus, onLogin }) {
  return (
    <header className="p-3 md:p-4 bg-neutral-900 border-b border-neutral-800 flex justify-between items-center shrink-0">
      <div className="flex items-center gap-2 md:gap-3">
        <img src="/logo.png" alt="Logo" className="w-10 h-10 md:w-12 md:h-12 object-contain" />
        <h1 className="text-xl md:text-2xl font-bold text-blue-500">APARICHAT</h1>
      </div>
      <div className="flex items-center gap-3 md:gap-4">
        <div className="flex items-center gap-2 md:gap-3">
          {user ? (
            <>
              <img src={user.photoURL} alt="pfp" className="hidden md:block w-8 h-8 rounded-full border border-neutral-700" />
              <button onClick={onLogout} className="text-neutral-400 hover:text-red-400 p-2 md:p-1" aria-label="Logout">
                <LogOut className="w-5 h-5" />
              </button>
            </>
          ) : (
            <button onClick={onLogin} className="text-sm font-semibold text-blue-400 hover:text-blue-300 mr-2">
              Login
            </button>
          )}
        </div>
        <button
          onClick={onNext}
          disabled={!socketReady}
          className={`px-3 md:px-5 py-1.5 text-sm md:text-base font-semibold rounded ${!socketReady ? 'bg-neutral-800 text-neutral-500' : matchStatus === 'connected' ? 'bg-amber-600' : 'bg-blue-600'}`}
        >
          {!socketReady && 'Connecting...'}
          {socketReady && matchStatus === 'idle' && 'Start'}
          {socketReady && matchStatus === 'searching' && 'Skip'}
          {socketReady && matchStatus === 'connected' && 'Next'}
        </button>
      </div>
    </header>
  );
}
