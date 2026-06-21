import React, { useState } from 'react';
import { Video, ShieldCheck, SkipForward } from 'lucide-react';

export function LandingScreen({ onStart }) {
  const [name, setName] = useState('');

  return (
    <div className="min-h-[100dvh] bg-[#0a0a0a] flex flex-col items-center justify-center text-white p-4 py-8 md:py-12 relative overflow-y-auto overflow-x-hidden font-sans">
      {/* Subtle Grid Background */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff1a_1px,transparent_1px),linear-gradient(to_bottom,#ffffff1a_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none" />
      
      <div className="z-10 w-full max-w-4xl flex flex-col items-center my-auto">
        {/* Brand/Logo */}
        <div className="flex flex-col items-center mb-6 md:mb-10">
          <img src="/logo.png" alt="Aparichat Logo" className="w-16 h-16 md:w-24 md:h-24 object-contain mb-3 drop-shadow-[0_0_15px_rgba(59,130,246,0.3)]" />
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-white">APARICHAT</h1>
          <p className="text-blue-500 font-medium mt-1 md:mt-2 tracking-wide text-xs md:text-base uppercase text-center">The Premium Random Video Chat</p>
        </div>

        {/* Main Action Card */}
        <div className="w-full max-w-md bg-[#111111] border border-neutral-800 rounded-2xl shadow-2xl p-5 md:p-8 mb-8 md:mb-12 relative overflow-hidden">
          {/* Subtle top border glow */}
          <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50" />
          
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              onStart(name.trim() || 'Stranger');
            }}
            className="space-y-4 md:space-y-6"
          >
            <div>
              <label className="block text-[10px] md:text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2 text-center">Nickname (Optional)</label>
              <input 
                type="text" 
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="What should we call you?" 
                className="w-full bg-neutral-950/50 border border-neutral-800 rounded-xl px-4 py-3 md:py-4 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all text-center text-base md:text-lg placeholder-neutral-600"
                maxLength={15}
              />
            </div>
            
            <button 
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 md:py-4 px-6 rounded-xl text-base md:text-lg transition-colors flex items-center justify-center gap-2"
            >
              Start Chatting
            </button>
          </form>
        </div>

        {/* Feature Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 w-full max-w-3xl text-center px-2 md:px-4">
          <div className="flex flex-col items-center">
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center mb-3 md:mb-4 text-blue-400">
              <Video className="w-5 h-5 md:w-6 md:h-6" />
            </div>
            <h3 className="font-semibold text-white mb-1 md:mb-2 text-sm md:text-base">Video or Text</h3>
            <p className="text-xs md:text-sm text-neutral-300 leading-relaxed max-w-[250px] md:max-w-none">Instantly connect via webcam or stick to text chat. You are in control.</p>
          </div>
          <div className="flex flex-col items-center">
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center mb-3 md:mb-4 text-purple-400">
              <SkipForward className="w-5 h-5 md:w-6 md:h-6" />
            </div>
            <h3 className="font-semibold text-white mb-1 md:mb-2 text-sm md:text-base">Instant Skip</h3>
            <p className="text-xs md:text-sm text-neutral-300 leading-relaxed max-w-[250px] md:max-w-none">Don't like the vibe? Press skip to instantly match with someone new.</p>
          </div>
          <div className="flex flex-col items-center">
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-neutral-900 border border-neutral-800 flex items-center justify-center mb-3 md:mb-4 text-green-400">
              <ShieldCheck className="w-5 h-5 md:w-6 md:h-6" />
            </div>
            <h3 className="font-semibold text-white mb-1 md:mb-2 text-sm md:text-base">Safe Community</h3>
            <p className="text-xs md:text-sm text-neutral-300 leading-relaxed max-w-[250px] md:max-w-none">Automated moderation and simple reporting tools keep the platform clean.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

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
