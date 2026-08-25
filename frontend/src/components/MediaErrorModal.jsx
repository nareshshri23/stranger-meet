import React from 'react';
import { CameraOff, VideoOff, AlertTriangle, Lock, RefreshCw, MessageSquare } from 'lucide-react';

export default function MediaErrorModal({ errorType, onRetry, onContinueTextOnly }) {
  if (!errorType) return null;

  const isPermissionDenied = errorType === 'NotAllowedError' || errorType === 'PermissionDeniedError';
  const isHardwareLocked = errorType === 'NotReadableError' || errorType === 'TrackStartError';
  const isNotFound = errorType === 'NotFoundError' || errorType === 'DevicesNotFoundError';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-2xl flex flex-col items-center text-center">
        
        {/* Error Icon */}
        <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4 text-red-400">
          {isPermissionDenied && <Lock className="w-8 h-8" />}
          {isHardwareLocked && <VideoOff className="w-8 h-8" />}
          {isNotFound && <CameraOff className="w-8 h-8" />}
          {!isPermissionDenied && !isHardwareLocked && !isNotFound && <AlertTriangle className="w-8 h-8" />}
        </div>

        {/* Title */}
        <h3 className="text-xl font-bold text-white mb-2">
          {isPermissionDenied && "Camera & Mic Blocked"}
          {isHardwareLocked && "Camera Used by Another App"}
          {isNotFound && "No Camera/Mic Detected"}
          {!isPermissionDenied && !isHardwareLocked && !isNotFound && "Media Device Error"}
        </h3>

        {/* Detailed Guidance */}
        <div className="text-sm text-neutral-300 mb-6 leading-relaxed">
          {isPermissionDenied && (
            <div className="space-y-2 text-left bg-neutral-800/60 p-4 rounded-xl border border-neutral-700/50">
              <p className="font-semibold text-neutral-200 text-center mb-2">How to unblock in 2 clicks:</p>
              <div className="flex items-start gap-2">
                <span className="bg-neutral-700 text-neutral-200 rounded-full w-5 h-5 flex items-center justify-center text-xs shrink-0 mt-0.5">1</span>
                <span>Click the <strong>Lock / Settings icon 🔒</strong> in your browser's address bar.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="bg-neutral-700 text-neutral-200 rounded-full w-5 h-5 flex items-center justify-center text-xs shrink-0 mt-0.5">2</span>
                <span>Change <strong>Camera</strong> and <strong>Microphone</strong> permissions to <strong>Allow</strong>.</span>
              </div>
            </div>
          )}

          {isHardwareLocked && (
            <p>
              Your webcam or microphone is currently being used by another application (like <strong>Zoom, MS Teams, Discord, OBS, or FaceTime</strong>).
              <br /><br />
              Please close those apps, then click <strong>Try Again</strong>.
            </p>
          )}

          {isNotFound && (
            <p>
              We couldn't detect a built-in or external webcam on this device. You can still enjoy meeting strangers using text chat!
            </p>
          )}

          {!isPermissionDenied && !isHardwareLocked && !isNotFound && (
            <p>
              Could not access media hardware ({errorType}). Please check your browser device permissions or restart your browser.
            </p>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 w-full">
          <button
            onClick={onRetry}
            className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2.5 px-4 rounded-xl transition-colors shadow-lg shadow-blue-600/20"
          >
            <RefreshCw className="w-4 h-4" />
            Try Again
          </button>
          
          <button
            onClick={onContinueTextOnly}
            className="flex-1 flex items-center justify-center gap-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-semibold py-2.5 px-4 rounded-xl transition-colors border border-neutral-700"
          >
            <MessageSquare className="w-4 h-4" />
            Text Chat Only
          </button>
        </div>

      </div>
    </div>
  );
}
