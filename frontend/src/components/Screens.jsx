import React from 'react';

export function LoadingScreen() {
  return <div className="h-[100dvh] bg-neutral-950 flex items-center justify-center text-neutral-500">Loading...</div>;
}

export function BannedScreen() {
  return (
    <div className="h-[100dvh] bg-neutral-950 flex flex-col items-center justify-center text-white p-4 text-center">
      <h1 className="text-4xl font-bold text-red-500 mb-4">BANNED</h1>
      <p className="text-neutral-400">Your Google Account has been blocked.</p>
    </div>
  );
}

export function LoginScreen({ onLogin }) {
  return (
    <div className="h-[100dvh] bg-neutral-950 flex flex-col items-center justify-center text-white p-4">
      <div className="bg-neutral-900 border border-neutral-800 p-8 rounded-lg max-w-md w-full text-center shadow-2xl">
        <h1 className="text-2xl font-bold text-blue-500 mb-4">APARICHAT</h1>
        <button onClick={onLogin} className="w-full flex items-center justify-center gap-3 px-6 py-3 rounded bg-white text-black font-semibold">
          Login with Google
        </button>
      </div>
    </div>
  );
}
