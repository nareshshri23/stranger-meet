import React from 'react';
import { User, Mic, MicOff, Video, VideoOff, AlertTriangle, Lock, ShieldCheck, Activity } from 'lucide-react';

export default function VideoSection({
  user,
  onLogin,
  remoteVidRef,
  selfVidRef,
  matchStatus,
  strangerNickname,
  myNickname,
  strangerCamActive,
  camActive,
  micActive,
  isPartnerReconnecting,
  isStrangerBackgrounded,
  icePhase,
  mediaError,
  onOpenPermissionsGuide,
  onSwitchCam,
  onSwitchMic,
  onReport
}) {
  const [remoteVideoPlaying, setRemoteVideoPlaying] = React.useState(false);

  React.useEffect(() => {
    if (!strangerCamActive || matchStatus !== 'connected' || isPartnerReconnecting) {
      setRemoteVideoPlaying(false);
    }
  }, [strangerCamActive, matchStatus, isPartnerReconnecting]);

  const showStrangerBlur = strangerCamActive && matchStatus === 'connected' && !user;
  const isPermissionBlocked = mediaError === 'NotAllowedError' || mediaError === 'PermissionDeniedError';

  return (
    <div className="relative w-full h-[40vh] xl:h-auto xl:flex-1 flex xl:flex-row gap-2 p-2 bg-neutral-900 shrink-0">
      
      {/* Remote Video Container */}
      <div className="w-full h-full xl:w-1/2 bg-black rounded-lg overflow-hidden border border-neutral-800 relative flex items-center justify-center">
        <video 
          ref={remoteVidRef} 
          autoPlay 
          playsInline 
          onPlaying={() => setRemoteVideoPlaying(true)}
          onLoadedData={() => setRemoteVideoPlaying(true)}
          className={`w-full h-full object-cover ${(!strangerCamActive || matchStatus !== 'connected' || isPartnerReconnecting || icePhase === 'securing' || icePhase === 'probing' || !remoteVideoPlaying) ? 'hidden' : ''} ${showStrangerBlur ? 'blur-2xl scale-110' : ''}`} 
        />

        {/* Video Decoding Spinner (Prevents Raw Black Frame while 4G buffers first Keyframe) */}
        {matchStatus === 'connected' && strangerCamActive && !remoteVideoPlaying && !isPartnerReconnecting && icePhase === 'connected' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-900 text-neutral-400 p-4 text-center">
            <div className="w-7 h-7 rounded-full border-2 border-blue-500 border-t-transparent animate-spin mb-2" />
            <p className="text-xs font-medium text-neutral-300">Receiving video feed...</p>
          </div>
        )}

        {/* Reconnecting Overlay */}
        {isPartnerReconnecting && matchStatus === 'connected' && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/75 backdrop-blur-sm text-center p-4">
            <div className="w-9 h-9 rounded-full border-3 border-amber-500 border-t-transparent animate-spin mb-3" />
            <p className="text-sm md:text-base font-bold text-amber-400">Stranger is reconnecting...</p>
            <p className="text-xs text-neutral-400 mt-1">Network switched or recovering connection</p>
          </div>
        )}

        {/* Mobile Backgrounded Overlay */}
        {!isPartnerReconnecting && isStrangerBackgrounded && matchStatus === 'connected' && strangerCamActive && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/60 backdrop-blur-xs text-center p-4">
            <div className="bg-neutral-900/90 border border-amber-500/40 rounded-full px-4 py-1.5 flex items-center gap-2 shadow-xl">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
              <p className="text-xs md:text-sm font-semibold text-amber-300">Stranger minimized the app</p>
            </div>
          </div>
        )}

        {/* Blur overlay for unauthenticated users */}
        {showStrangerBlur && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/40 text-center p-4">
            <Video className="w-12 h-12 xl:w-16 xl:h-16 mb-4 text-neutral-300" />
            <p className="text-sm xl:text-base font-medium text-white mb-4">Stranger shared video.<br/>Login to view and share yours.</p>
            <button onClick={onLogin} className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-6 rounded-full transition-colors">
              Login to View
            </button>
          </div>
        )}

        {/* Idle State */}
        {matchStatus === 'idle' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-800 text-neutral-500">
            <User className="w-12 h-12 xl:w-24 xl:h-24 mb-4 opacity-20" />
            <p className="text-sm font-medium">Click Start to meet someone</p>
          </div>
        )}

        {/* Searching in Queue State */}
        {matchStatus === 'searching' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-800 text-neutral-400">
            <div className="animate-pulse flex flex-col items-center">
              <User className="w-12 h-12 xl:w-24 xl:h-24 mb-4 opacity-50" />
              <p className="text-sm font-medium">Looking for a stranger...</p>
            </div>
          </div>
        )}

        {/* Granular WebRTC Handshake Phases (Eliminates dead silence) */}
        {matchStatus === 'connected' && icePhase === 'securing' && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-neutral-900/90 text-center p-4 animate-in fade-in">
            <ShieldCheck className="w-10 h-10 text-blue-400 animate-pulse mb-3" />
            <p className="text-sm font-semibold text-white">Match found!</p>
            <p className="text-xs text-neutral-400 mt-1">Securing connection & encryption...</p>
          </div>
        )}

        {matchStatus === 'connected' && icePhase === 'probing' && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-neutral-900/90 text-center p-4 animate-in fade-in">
            <Activity className="w-10 h-10 text-emerald-400 animate-bounce mb-3" />
            <p className="text-sm font-semibold text-white">Connecting live stream...</p>
            <p className="text-xs text-neutral-400 mt-1">Optimizing peer-to-peer route</p>
          </div>
        )}

        {/* Connected but stranger camera is off */}
        {matchStatus === 'connected' && !strangerCamActive && icePhase === 'connected' && (
          <div className="absolute inset-0 flex items-center justify-center bg-neutral-800">
            <User className="w-12 h-12 xl:w-24 xl:h-24 text-neutral-600" />
          </div>
        )}

        <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-0.5 rounded text-xs z-20">{strangerNickname || 'Stranger'}</div>
        {matchStatus === 'connected' && (
          <button onClick={onReport} title="Report Stranger" className="absolute top-2 left-2 flex items-center bg-red-600/80 hover:bg-red-500 py-1 px-2 rounded text-white text-xs font-semibold z-20 transition-colors">
            <AlertTriangle className="w-3 h-3 mr-1" />
            Report
          </button>
        )}
      </div>

      {/* Self Video Container */}
      <div className="absolute top-4 right-4 xl:top-auto xl:right-auto w-24 h-36 xl:relative xl:w-1/2 xl:h-full z-30 bg-neutral-800 rounded-lg overflow-hidden border border-neutral-600 shadow-2xl xl:shadow-none flex items-center justify-center">
        <video 
          ref={selfVidRef} 
          autoPlay 
          playsInline 
          muted 
          className={`w-full h-full object-cover -scale-x-100 ${!camActive ? 'hidden' : ''}`} 
        />
        
        {/* Fallback when Camera is Off */}
        {!camActive && !isPermissionBlocked && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-800 text-neutral-500">
            <User className="w-8 h-8 xl:w-20 xl:h-20 text-neutral-600" />
            {micActive && (
              <div className="mt-2 flex items-center gap-1">
                <span className="w-1.5 h-3 bg-emerald-400 rounded-full animate-bounce" />
                <span className="w-1.5 h-5 bg-emerald-400 rounded-full animate-bounce [animation-delay:0.15s]" />
                <span className="w-1.5 h-3 bg-emerald-400 rounded-full animate-bounce [animation-delay:0.3s]" />
              </div>
            )}
          </div>
        )}

        {/* Actionable Permission Block Card */}
        {isPermissionBlocked && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-950/80 p-2 text-center text-red-200">
            <Lock className="w-5 h-5 xl:w-8 xl:h-8 mb-1 text-red-400" />
            <p className="text-[10px] xl:text-xs font-semibold">Camera Blocked</p>
            <button 
              onClick={onOpenPermissionsGuide} 
              className="mt-1.5 bg-neutral-900 hover:bg-neutral-800 text-white text-[9px] xl:text-xs py-1 px-2 rounded border border-neutral-700 transition-colors"
            >
              How to Unblock
            </button>
          </div>
        )}

        {/* Media Controls */}
        <div className="absolute top-1 right-1 flex flex-col xl:flex-row gap-1 z-10">
          <button onClick={onSwitchMic} className="bg-neutral-900/80 p-1.5 rounded hover:bg-neutral-800 transition-colors" aria-label={micActive ? "Mute Microphone" : "Unmute Microphone"}>
            {micActive ? <Mic className="w-4 h-4 text-white" /> : <MicOff className="w-4 h-4 text-red-500" />}
          </button>
          <button onClick={onSwitchCam} className="bg-neutral-900/80 p-1.5 rounded hover:bg-neutral-800 transition-colors" aria-label={camActive ? "Turn Off Camera" : "Turn On Camera"}>
            {camActive ? <Video className="w-4 h-4 text-white" /> : <VideoOff className="w-4 h-4 text-red-500" />}
          </button>
        </div>

        <div className="absolute bottom-1 left-1 xl:bottom-2 xl:left-2 bg-black/60 px-2 py-0.5 rounded text-[10px] xl:text-xs z-20 text-white">
          You
        </div>
      </div>

    </div>
  );
}
