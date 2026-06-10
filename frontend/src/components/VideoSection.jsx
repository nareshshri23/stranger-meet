import React from 'react';
import { User, Mic, MicOff, Video, VideoOff, AlertTriangle } from 'lucide-react';

export default function VideoSection({
  user,
  onLogin,
  remoteVidRef,
  selfVidRef,
  matchStatus,
  strangerCamActive,
  camActive,
  micActive,
  onSwitchCam,
  onSwitchMic,
  onReport
}) {
  const showStrangerBlur = strangerCamActive && matchStatus === 'connected' && !user;

  return (
    <div className="relative w-full h-[40vh] md:h-auto md:flex-1 flex md:flex-row gap-2 p-2 bg-neutral-900 shrink-0">
      <div className="w-full h-full md:w-1/2 bg-black rounded-lg overflow-hidden border border-neutral-800 relative flex items-center justify-center">
        <video ref={remoteVidRef} autoPlay playsInline className={`w-full h-full object-cover ${(!strangerCamActive || matchStatus !== 'connected') ? 'hidden' : ''} ${showStrangerBlur ? 'blur-2xl scale-110' : ''}`} />

        {showStrangerBlur && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/40 text-center p-4">
            <Video className="w-12 h-12 md:w-16 md:h-16 mb-4 text-neutral-300" />
            <p className="text-sm md:text-base font-medium text-white mb-4">Stranger shared video.<br/>Login to view and share yours.</p>
            <button onClick={onLogin} className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-6 rounded-full transition-colors">
              Login to View
            </button>
          </div>
        )}

        {matchStatus === 'idle' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-800 text-neutral-500">
            <User className="w-12 h-12 md:w-24 md:h-24 mb-4 opacity-20" />
            <p className="text-sm font-medium">Click Start to meet someone</p>
          </div>
        )}

        {matchStatus === 'searching' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-800 text-neutral-400">
            <div className="animate-pulse flex flex-col items-center">
              <User className="w-12 h-12 md:w-24 md:h-24 mb-4 opacity-50" />
              <p className="text-sm font-medium">Looking for a stranger...</p>
            </div>
          </div>
        )}

        {matchStatus === 'connected' && !strangerCamActive && (
          <div className="absolute inset-0 flex items-center justify-center bg-neutral-800"><User className="w-12 h-12 md:w-24 md:h-24 text-neutral-600" /></div>
        )}

        <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-0.5 rounded text-xs z-20">Stranger</div>
        {matchStatus === 'connected' && (
          <button onClick={onReport} title="Report Stranger" className="absolute top-2 left-2 flex items-center bg-red-600/80 hover:bg-red-500 py-1 px-2 rounded text-white text-xs font-semibold z-20 transition-colors">
            <AlertTriangle className="w-3 h-3 mr-1" />
            Report
          </button>
        )}
      </div>

      <div className="absolute bottom-4 right-4 md:bottom-auto md:right-auto w-24 h-36 md:relative md:w-1/2 md:h-full z-30 bg-neutral-800 rounded-lg overflow-hidden border border-neutral-600 shadow-2xl md:shadow-none flex items-center justify-center">
        <video ref={selfVidRef} autoPlay playsInline muted className={`w-full h-full object-cover transform -scale-x-100 ${!camActive ? 'hidden' : ''}`} />
        {!camActive && <div className="absolute inset-0 flex items-center justify-center bg-neutral-800"><User className="w-12 h-12 md:w-24 md:h-24 text-neutral-600" /></div>}
        <div className="absolute top-1 right-1 flex flex-col md:flex-row gap-1 z-10">
          <button onClick={onSwitchMic} className="bg-neutral-900/80 p-1.5 rounded">
            {micActive ? <Mic className="w-4 h-4 text-white" /> : <MicOff className="w-4 h-4 text-red-500" />}
          </button>
          <button onClick={onSwitchCam} className="bg-neutral-900/80 p-1.5 rounded">
            {camActive ? <Video className="w-4 h-4 text-white" /> : <VideoOff className="w-4 h-4 text-red-500" />}
          </button>
        </div>
      </div>
    </div>
  );
}
