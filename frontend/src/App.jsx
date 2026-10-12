import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { auth, logInWithGoogle, logOut } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { Analytics } from '@vercel/analytics/react';

import { LoadingScreen, BannedScreen, LandingScreen } from './components/Screens';
import Header from './components/Header';
import VideoSection from './components/VideoSection';
import ChatBox from './components/ChatBox';
import MediaErrorModal from './components/MediaErrorModal';
import NetworkToast from './components/NetworkToast';
import { 
  sanitizePeerMessage, 
  sanitizeNickname, 
  sanitizeCamToggle, 
  createPeerRateLimiter 
} from './utils/sanitize';

const SOKET_URL = import.meta.env.VITE_BACKEND_URL || (
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:5000' 
    : 'https://stranger-meet-api.onrender.com'
);

const getDeviceId = () => {
    let id = localStorage.getItem('device_id');
    if (!id) { 
      id = 'device_' + Math.random().toString(36).substring(2) + Date.now().toString(36); 
      localStorage.setItem('device_id', id); 
    }
    return id;
}

const isMobileBrowser = () => {
  const userAgent = navigator.userAgent || navigator.vendor || window.opera || '';
  return /android|iphone|ipad|ipod|iemobile|mobile/i.test(userAgent)
    || (navigator.maxTouchPoints > 1 && window.innerWidth < 1024);
}

export default function App() {
  const [u, setU] = useState(null)
  const userRef = useRef(null)
  const [loadingAuth, setLoadingAuth] = useState(true)
  const [bannedFlg, setBannedFlg] = useState(false)

  const [hasStarted, setHasStarted] = useState(false)
  const [myNickname, setMyNickname] = useState('Stranger')
  const [strangerNickname, setStrangerNickname] = useState('Stranger')

  const myNicknameRef = useRef('Stranger')
  const strangerNicknameRef = useRef('Stranger')

  const [sockt, setSockt] = useState(null)
  const [socketReady, setSocketReady] = useState(false)
  const [matchStatus, setMatchStatus] = useState('idle')
  const [icePhase, setIcePhase] = useState('idle') // 'idle' | 'searching' | 'securing' | 'probing' | 'connected'
  const icePhaseRef = useRef('idle')

  const [networkToast, setNetworkToast] = useState(null)
  const networkToastTimer = useRef(null)

  const [isPartnerReconnecting, setIsPartnerReconnecting] = useState(false)
  const [isStrangerBackgrounded, setIsStrangerBackgrounded] = useState(false)
  const [mediaError, setMediaError] = useState(null)

  const [chatLog, setChatLog] = useState([])
  const [msgInput, setMsgInput] = useState('')
  const [strangerTyping, setStrangerTyping] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [strangerCamActive, setStrangerCamActive] = useState(false)

  const [camActive, setCamActive] = useState(false)
  const [micActive, setMicActive] = useState(false)
  const camActiveRef = useRef(false)

  const selfVidRef = useRef(null)
  const remoteVidRef = useRef(null)
  const remoteAudioRef = useRef(null)
  const localStreamObj = useRef(null)
  const remoteStreamRef = useRef(new MediaStream())

  let pcRef = useRef(null)
  let dataChanRef = useRef(null)
  let waitQueue = useRef([])
  let pendingSignalsRef = useRef([])
  let signalProcessorRef = useRef(null)
  let typingTimeoutRef = useRef(null)
  let pendingPeerPacketsRef = useRef([])
  let lastTypingSendRef = useRef(0)
  let negotiationPendingRef = useRef(false)
  let negotiationInProgressRef = useRef(false)
  let makingOfferRef = useRef(false)
  let politePeerRef = useRef(false)
  let ignoreOfferRef = useRef(false)
  let renegotiatePeerRef = useRef(null)

  const flushPendingPeerPackets = () => {
    if (!dataChanRef.current || dataChanRef.current.readyState !== 'open') return;
    while (pendingPeerPacketsRef.current.length > 0) {
      const packet = pendingPeerPacketsRef.current.shift();
      try {
        dataChanRef.current.send(JSON.stringify(packet));
      } catch {
        pendingPeerPacketsRef.current.unshift(packet);
        break;
      }
    }
  }

  const sendPeerPacket = (type, payload) => {
    const packet = { type, payload };

    if (!dataChanRef.current || dataChanRef.current.readyState !== 'open') {
      if (pendingPeerPacketsRef.current.length < 50) {
        pendingPeerPacketsRef.current.push(packet);
      }
      return false;
    }
    try {
      dataChanRef.current.send(JSON.stringify(packet));
      return true;
    } catch {
      if (pendingPeerPacketsRef.current.length < 50) {
        pendingPeerPacketsRef.current.push(packet);
      }
      return false;
    }
  }

  const showNetworkToast = useCallback((message, type = 'info', duration = 4000) => {
    if (networkToastTimer.current) clearTimeout(networkToastTimer.current);
    setNetworkToast({ message, type });
    if (duration > 0) {
      networkToastTimer.current = setTimeout(() => {
        setNetworkToast(null);
      }, duration);
    }
  }, []);

  /**
   * Complete hardware teardown to guarantee webcams/microphones turn OFF
   */
  const stopAllMediaTracks = () => {
    if (localStreamObj.current) {
      localStreamObj.current.getTracks().forEach(track => {
        try {
          track.stop();
        } catch {
          /* ignore cleanup race */
        }
      });
      localStreamObj.current = null;
    }
    if (selfVidRef.current) {
      selfVidRef.current.srcObject = null;
    }
    setCamActive(false);
    camActiveRef.current = false;
    setMicActive(false);
  }

  /**
   * Complete WebRTC PeerConnection and DataChannel disposal
   */
  const destroyPeerConnection = () => {
    if (dataChanRef.current) {
      try {
        dataChanRef.current.onmessage = null;
        dataChanRef.current.onopen = null;
        dataChanRef.current.onclose = null;
        dataChanRef.current.close();
      } catch {
        /* ignore close race */
      }
      dataChanRef.current = null;
    }
    if (pcRef.current) {
      try {
        pcRef.current.ontrack = null;
        pcRef.current.onicecandidate = null;
        pcRef.current.ondatachannel = null;
        pcRef.current.oniceconnectionstatechange = null;
        pcRef.current.onconnectionstatechange = null;
        pcRef.current.close();
      } catch {
        /* ignore close race */
      }
      pcRef.current = null;
    }
    if (remoteVidRef.current) {
      remoteVidRef.current.srcObject = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    remoteStreamRef.current = new MediaStream();
    pendingPeerPacketsRef.current = [];
    pendingSignalsRef.current = [];
    waitQueue.current = [];
    negotiationPendingRef.current = false;
    negotiationInProgressRef.current = false;
    setStrangerCamActive(false);
  }

  const getPeerSender = (kind) => {
    if (!pcRef.current) return null;

    const directSender = pcRef.current.getSenders().find(sender => sender.track?.kind === kind);
    if (directSender) return directSender;

    const transceiver = pcRef.current.getTransceivers().find(item => {
      return item.sender && (item.sender.track?.kind === kind || item.receiver?.track?.kind === kind);
    });

    return transceiver?.sender || null;
  }

  const syncLocalTracksToPeer = useCallback(async () => {
    if (!pcRef.current || !localStreamObj.current) return;

    const stream = localStreamObj.current;
    const desiredKinds = new Set(stream.getTracks().map(track => track.kind));

    stream.getTracks().forEach(track => {
      const sender = getPeerSender(track.kind);
      if (sender) {
        if (sender.track !== track) sender.replaceTrack(track);
      } else {
        pcRef.current.addTrack(track, stream);
      }
    });

    pcRef.current.getSenders().forEach(sender => {
      if (sender.track && !desiredKinds.has(sender.track.kind)) {
        sender.replaceTrack(null);
      }
    });
  }, []);

  const renegotiatePeerAfterMediaChange = useCallback(async () => {
    if (!pcRef.current || !sockt) return;
    negotiationPendingRef.current = true;
    if (negotiationInProgressRef.current || pcRef.current.signalingState !== 'stable') return;

    negotiationInProgressRef.current = true;
    try {
      negotiationPendingRef.current = false;
      makingOfferRef.current = true;
      const offer = await pcRef.current.createOffer();
      await pcRef.current.setLocalDescription(offer);
      sockt.emit('send_signal', { sdp: pcRef.current.localDescription });
    } catch (err) {
      console.warn('[WebRTC] media renegotiation failed:', err);
    } finally {
      makingOfferRef.current = false;
      negotiationInProgressRef.current = false;
    }
  }, [sockt]);

  useEffect(() => {
    renegotiatePeerRef.current = renegotiatePeerAfterMediaChange;
    return () => {
      renegotiatePeerRef.current = null;
    };
  }, [renegotiatePeerAfterMediaChange]);

  const initMedia = async (reqVideo, reqAudio) => {
      if (!reqVideo && !reqAudio) {
        stopAllMediaTracks();
        setCamActive(false);
        setMicActive(false);
        return;
      }

      try {
          let constraints = {};
          if (reqVideo) constraints.video = { width: { ideal: 640, max: 1280 }, height: { ideal: 480, max: 720 }, frameRate: { ideal: 24, max: 30 } };
          if (reqAudio) constraints.audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
          
          let s;
          try {
            s = await navigator.mediaDevices.getUserMedia(constraints);
          } catch {
            s = await navigator.mediaDevices.getUserMedia({
              video: reqVideo ? true : false,
              audio: reqAudio ? true : false
            });
          }

          localStreamObj.current = s;
          if (selfVidRef.current) selfVidRef.current.srcObject = s;
          
          setCamActive(reqVideo);
          camActiveRef.current = reqVideo;
          setMicActive(reqAudio);
          setMediaError(null);

          if (dataChanRef.current && dataChanRef.current.readyState === 'open') {
              dataChanRef.current.send(JSON.stringify({ type: 'cam_toggle', payload: reqVideo }));
          }

          if (pcRef.current) {
              await syncLocalTracksToPeer();
              if (pcRef.current.connectionState === 'connected' && sockt) {
                await renegotiatePeerAfterMediaChange();
              }
          }
      } catch (err) {
          console.warn("[HARDWARE ERROR] getUserMedia failed:", err.name, err.message);
          setMediaError(err.name || 'Error');
      }
  }

  // Cleanup on tab close / browser navigation with instant leave broadcast
  useEffect(() => {
    const handleUnload = () => {
      if (dataChanRef.current && dataChanRef.current.readyState === 'open') {
        try { dataChanRef.current.send(JSON.stringify({ type: 'peer_left' })); } catch {
          /* ignore unload race */
        }
      }
      if (sockt) {
        try { sockt.emit('leave_partner'); } catch {
          /* ignore unload race */
        }
      }
      stopAllMediaTracks();
      destroyPeerConnection();
    };
    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      window.removeEventListener('pagehide', handleUnload);
    };
  }, [sockt]);

  // Mobile Background Throttling & Visibility Recovery
  useEffect(() => {
    const handleVisibilityChange = () => {
      const isHidden = document.hidden;
      
      // 1. Preserve Mobile Battery and Prevent iOS WebRTC Crashes
      if (localStreamObj.current) {
        localStreamObj.current.getVideoTracks().forEach(track => {
          track.enabled = isHidden ? false : camActiveRef.current;
        });
      }

      // 2. Notify Peer via DataChannel
      if (dataChanRef.current && dataChanRef.current.readyState === 'open') {
        dataChanRef.current.send(JSON.stringify({ type: 'app_backgrounded', payload: isHidden }));
      }

      // 3. WebRTC Stalled State Recovery upon Returning
      if (!isHidden && pcRef.current) {
        if (pcRef.current.iceConnectionState === 'disconnected' || pcRef.current.iceConnectionState === 'failed') {
          console.log("[LIFECYCLE] App restored from background. Triggering WebRTC ICE recovery...");
          try { pcRef.current.restartIce(); } catch {
            /* ignore browser restart rejection */
          }
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const attachDataEvents = useCallback((chan) => {
    const peerRateLimiter = createPeerRateLimiter(12, 2000);

    chan.onopen = () => {
      flushPendingPeerPackets();
      sendPeerPacket('cam_toggle', camActiveRef.current);
      sendPeerPacket('nickname', myNicknameRef.current);
    };

    chan.onclose = () => {
      console.log('[DataChannel] Peer closed data channel.');
      if (remoteVidRef.current) remoteVidRef.current.srcObject = null;
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
      setStrangerCamActive(false);
    };

    chan.onmessage = (evt) => {
      if (!peerRateLimiter()) return;

      try {
        const data = JSON.parse(evt.data);
        if (!data || typeof data !== 'object') return;

        if (data.type === 'peer_left') {
          setIsPartnerReconnecting(false);
          setIsStrangerBackgrounded(false);
          setMatchStatus('idle');
          setIcePhase('idle');
          icePhaseRef.current = 'idle';
          setStrangerTyping(false);
          setStrangerCamActive(false);
          if (remoteVidRef.current) remoteVidRef.current.srcObject = null;
          if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
          setChatLog((prev) => [...prev, { senderName: 'Sys', text: 'Stranger disconnected.', isSelf: false, isSys: true }]);
          destroyPeerConnection();
          return;
        }

        if (data.type === 'msg') {
          setStrangerTyping(false);
          const safeText = sanitizePeerMessage(data.payload);
          if (safeText) {
            setChatLog((prev) => [...prev, {
              senderName: strangerNicknameRef.current,
              text: safeText,
              isSelf: false,
              isSys: false
            }]);
          }
        } else if (data.type === 'typing') {
          setStrangerTyping(true);
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = setTimeout(() => {
            setStrangerTyping(false);
          }, 2000);
        } else if (data.type === 'cam_toggle') {
          setStrangerCamActive(sanitizeCamToggle(data.payload));
        } else if (data.type === 'nickname') {
          const safeNick = sanitizeNickname(data.payload);
          setStrangerNickname(safeNick);
          strangerNicknameRef.current = safeNick;
        } else if (data.type === 'app_backgrounded') {
          setIsStrangerBackgrounded(data.payload === true);
        }
      } catch {
        const safeRaw = sanitizePeerMessage(evt.data);
        if (safeRaw) {
          setStrangerTyping(false);
          setChatLog((prev) => [...prev, {
            senderName: strangerNicknameRef.current,
            text: safeRaw,
            isSelf: false,
            isSys: false
          }]);
        }
      }
    };
  }, []);

  const initWebRTC = useCallback(async (isCaller, sockInstance, dynamicIceServers) => {
    destroyPeerConnection();
    politePeerRef.current = !isCaller;
    negotiationPendingRef.current = false;
    negotiationInProgressRef.current = false;
    makingOfferRef.current = false;
    ignoreOfferRef.current = false;

    let resolvedIceServers = Array.isArray(dynamicIceServers) && dynamicIceServers.length > 0
      ? dynamicIceServers
      : [
          {
            urls: [
              'stun:stun.l.google.com:19302',
              'stun:stun1.l.google.com:19302',
              'stun:stun2.l.google.com:19302',
              'stun:stun3.l.google.com:19302',
              'stun:stun4.l.google.com:19302',
              'stun:stun.cloudflare.com:3478',
              'stun:global.stun.twilio.com:3478'
            ]
          }
        ];

    if (!Array.isArray(dynamicIceServers) || dynamicIceServers.length === 0) {
      try {
        const response = await fetch(`${SOKET_URL}/api/turn-credentials`, { method: 'GET' });
        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data.iceServers) && data.iceServers.length > 0) {
            resolvedIceServers = data.iceServers;
          }
        }
      } catch (err) {
        console.warn('[WebRTC] Failed to fetch TURN config from backend:', err.message);
      }
    }

    const rtcConfig = {
      iceServers: resolvedIceServers,
      iceCandidatePoolSize: 10
    };

    const peerCnn = new RTCPeerConnection(rtcConfig);
    pcRef.current = peerCnn;

    try {
      peerCnn.addTransceiver('audio', { direction: 'sendrecv' });
      peerCnn.addTransceiver('video', { direction: 'sendrecv' });
    } catch {
      /* some browsers reject transceiver pre-allocation; keep the rest of negotiation running */
    }

    peerCnn.oniceconnectionstatechange = () => {
      const state = peerCnn.iceConnectionState;
      if (state === 'checking') {
        setIcePhase(prev => (prev !== 'connected' ? 'probing' : prev));
        icePhaseRef.current = 'probing';
      } else if (state === 'connected' || state === 'completed') {
        setIcePhase('connected');
        icePhaseRef.current = 'connected';
        showNetworkToast('Video stream connected!', 'success', 2500);
      } else if (state === 'disconnected') {
        console.warn('[WebRTC] ICE Disconnected. Network switch detected.');
        showNetworkToast('Network route changed (Wi-Fi/4G). Reconnecting video...', 'warning', 6000);
      } else if (state === 'failed') {
        console.warn('[WebRTC] ICE Connection Failed. Requesting ICE Restart...');
        showNetworkToast('Network path failed. Negotiating new route...', 'warning', 6000);
        try {
          peerCnn.restartIce();
        } catch {
          /* keep ICE recovery resilient when the browser rejects an immediate restart */
        }
      }
    };

    if (isCaller) {
      const dChan = peerCnn.createDataChannel('chat');
      dataChanRef.current = dChan;
      dChan.bufferedAmountLowThreshold = 8 * 1024;
      dChan.onbufferedamountlow = () => flushPendingPeerPackets();

      const handleChannelOpen = () => {
        flushPendingPeerPackets();
        sendPeerPacket('cam_toggle', camActiveRef.current);
        sendPeerPacket('nickname', myNicknameRef.current);
      };

      if (dChan.readyState === 'open') {
        handleChannelOpen();
      } else {
        dChan.onopen = handleChannelOpen;
      }

      attachDataEvents(dChan);
    } else {
      peerCnn.ondatachannel = (evt) => {
        dataChanRef.current = evt.channel;
        evt.channel.bufferedAmountLowThreshold = 8 * 1024;
        evt.channel.onbufferedamountlow = () => flushPendingPeerPackets();

        const handleChannelOpen = () => {
          flushPendingPeerPackets();
          sendPeerPacket('cam_toggle', camActiveRef.current);
          sendPeerPacket('nickname', myNicknameRef.current);
        };

        if (evt.channel.readyState === 'open') {
          handleChannelOpen();
        } else {
          evt.channel.onopen = handleChannelOpen;
        }

        attachDataEvents(evt.channel);
      };
    }

    peerCnn.onconnectionstatechange = () => {
      const state = peerCnn.connectionState;
      console.log('[WebRTC] PeerConnection State:', state);
      if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        if (remoteVidRef.current) remoteVidRef.current.srcObject = null;
        if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
        setStrangerCamActive(false);
      }
    };

    peerCnn.onicecandidate = (evt) => {
      if (evt.candidate) {
        sockInstance.emit('send_signal', { iceCandidate: evt.candidate });
      }
    };

    peerCnn.ontrack = (evt) => {
      const incomingStream = evt.streams && evt.streams[0] ? evt.streams[0] : remoteStreamRef.current;

      if (incomingStream && !incomingStream.getTracks().includes(evt.track)) {
        incomingStream.addTrack(evt.track);
      }

      remoteStreamRef.current = incomingStream;
      if (remoteVidRef.current) remoteVidRef.current.srcObject = incomingStream;
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = incomingStream;
        remoteAudioRef.current.play().catch(() => {
          // Browser autoplay may wait for a user interaction.
        });
      }
      if (evt.track.kind === 'video') {
        evt.track.onunmute = () => setStrangerCamActive(true);
        evt.track.onmute = () => setStrangerCamActive(false);
      }

      evt.track.onended = () => {
        console.log('[WebRTC] Remote media track ended.');

        const remainingTracks = remoteStreamRef.current.getTracks().filter(track => track !== evt.track && track.readyState !== 'ended');

        if (remainingTracks.length === 0) {
          if (remoteVidRef.current) remoteVidRef.current.srcObject = null;
          if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
          setStrangerCamActive(false);
        } else if (remoteVidRef.current) {
          remoteVidRef.current.srcObject = remoteStreamRef.current;
        }
      };
    };

    if (localStreamObj.current) {
      localStreamObj.current.getTracks().forEach(trk => {
        const sender = getPeerSender(trk.kind);
        if (sender) sender.replaceTrack(trk);
        else peerCnn.addTrack(trk, localStreamObj.current);
      });
    }

    const pendingSignals = pendingSignalsRef.current.splice(0);
    for (const signal of pendingSignals) {
      if (signalProcessorRef.current) {
        await signalProcessorRef.current(signal);
      }
    }

    if (isCaller) {
      try {
        const offerSdp = await peerCnn.createOffer();
        await peerCnn.setLocalDescription(offerSdp);
        sockInstance.emit('send_signal', { sdp: peerCnn.localDescription });
      } catch (error) {
        console.log('[WebRTC] Offer creation failed:', error);
      }
    }
  }, [attachDataEvents, showNetworkToast]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (usr) => {
      userRef.current = usr
      setU(usr)
      setLoadingAuth(false)
    });
    return () => unsub();
  }, [])

  useEffect(() => {
    if (loadingAuth) return;

    let active = true;
    let socketInstance = null;

    const connectSocket = async () => {
      let authPayload = { token: getDeviceId() };

      const currentUser = userRef.current;
      if (currentUser) {
        authPayload.userId = currentUser.uid || getDeviceId();
        if (currentUser.email) {
          authPayload.email = currentUser.email;
        }

        try {
          const firebaseToken = await currentUser.getIdToken();
          if (firebaseToken) {
            authPayload.firebaseToken = firebaseToken;
          }
        } catch (err) {
          console.warn('[AUTH] Failed to fetch Firebase token for socket auth:', err.message);
        }
      }

      if (!active) return;

      socketInstance = io(SOKET_URL, { 
        auth: authPayload,
        reconnection: true,
        reconnectionAttempts: 15,
        reconnectionDelay: 1000
      })
      setSockt(socketInstance)

      socketInstance.on('connect', () => { 
        setSocketReady(true);
        setNetworkToast(prev => prev?.type === 'error' ? null : prev);
      })
    
      socketInstance.on('disconnect', () => { 
        setSocketReady(false);
        showNetworkToast("Signaling connection lost. Reconnecting to server...", "error", 0);
      })

      socketInstance.on('connect_error', (err) => {
        console.error("rejected by srvr:", err.message);
        if (err.message.includes('banned')) {
          setBannedFlg(true);
        }
        setSocketReady(false);
      });

      socketInstance.on('waiting', (data) => {
        setIsPartnerReconnecting(false)
        setIsStrangerBackgrounded(false)
        setMatchStatus('searching')
        setIcePhase('searching')
        icePhaseRef.current = 'searching'
        setChatLog([{ senderName: 'Sys', text: data.message, isSelf: false, isSys: true }])
      })

      socketInstance.on('matched', async (data) => {
        setIsPartnerReconnecting(false)
        setIsStrangerBackgrounded(false)
        setMatchStatus('connected')
        setIcePhase('securing')
        icePhaseRef.current = 'securing'
        setChatLog((prev) => [...prev, { senderName: 'Sys', text: 'Connected! Say hi', isSelf: false, isSys: true }])
        initWebRTC(data.createOffer, socketInstance, data.iceServers)
      })

      // Edge Case 2: Graceful "Tunnel Drop" Reconnect Handling
      socketInstance.on('partner_reconnecting', (data) => {
        setIsPartnerReconnecting(true);
        setStrangerCamActive(false);
        if (remoteVidRef.current) remoteVidRef.current.srcObject = null;
        if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
        setChatLog((prev) => [...prev, { senderName: 'Sys', text: data.message || 'Stranger network switched. Reconnecting...', isSelf: false, isSys: true }]);
      })

      socketInstance.on('session_recovered', async (data) => {
        setIsPartnerReconnecting(false)
        showNetworkToast("⚡ Reconnected with stranger!", "success", 3000)
        setChatLog((prev) => [...prev, { senderName: 'Sys', text: '⚡ Reconnected with stranger!', isSelf: false, isSys: true }])
        
        // Perform seamless ICE restart
        if (pcRef.current) {
          try {
            if (data.isCaller) {
              pcRef.current.restartIce()
              const offer = await pcRef.current.createOffer({ iceRestart: true })
              await pcRef.current.setLocalDescription(offer)
              socketInstance.emit('send_signal', { sdp: pcRef.current.localDescription })
            }
          } catch {
            /* ignore reconnect race and rebuild a fresh peer path */
            initWebRTC(data.isCaller, socketInstance, data.iceServers)
          }
        } else {
          initWebRTC(data.isCaller, socketInstance, data.iceServers)
        }
      })

      const processSignal = async (info) => {
        if (!pcRef.current) return false
        try {
          if (info.sdp) {
            const description = new RTCSessionDescription(info.sdp);
            const offerCollision = description.type === 'offer'
              && (makingOfferRef.current || pcRef.current.signalingState !== 'stable');

            ignoreOfferRef.current = !politePeerRef.current && offerCollision;
            if (ignoreOfferRef.current) return true;

            if (offerCollision && politePeerRef.current) {
              await pcRef.current.setLocalDescription({ type: 'rollback' });
            }

            await pcRef.current.setRemoteDescription(description)

            if (description.type === 'offer') {
              let reply = await pcRef.current.createAnswer()
              await pcRef.current.setLocalDescription(reply)
              socketInstance.emit('send_signal', { sdp: pcRef.current.localDescription })
            }

            // Flush queued candidates AFTER remote description and answer are set
            while (waitQueue.current.length > 0) {
              let tempCand = waitQueue.current.shift()
              try {
                await pcRef.current.addIceCandidate(new RTCIceCandidate(tempCand))
              } catch {
                /* ignore stale candidate during signal buffering */
              }
            }

            if (description.type === 'answer' && negotiationPendingRef.current) {
              await renegotiatePeerRef.current?.();
            }
          }
          if (info.iceCandidate) {
            if (ignoreOfferRef.current) return true;
            if (pcRef.current.remoteDescription && pcRef.current.remoteDescription.type) {
              try {
                await pcRef.current.addIceCandidate(new RTCIceCandidate(info.iceCandidate))
              } catch {
                /* ignore candidate processing race */
              }
            } else {
              waitQueue.current.push(info.iceCandidate)
            }
          }
          return true
        } catch (e) {
          console.warn("[WebRTC] Signal error:", e)
          return false
        }
      }

      signalProcessorRef.current = processSignal

      socketInstance.on('receive_signal', async (info) => {
        if (!pcRef.current) {
          if (pendingSignalsRef.current.length < 64) {
            pendingSignalsRef.current.push(info)
          }
          return
        }

        await processSignal(info)
      })

      socketInstance.on('partner_disconnected', (info) => {
        setIsPartnerReconnecting(false)
        setIsStrangerBackgrounded(false)
        setMatchStatus('idle')
        setIcePhase('idle')
        icePhaseRef.current = 'idle'
        setStrangerTyping(false)
        setStrangerCamActive(false)
        if (remoteVidRef.current) remoteVidRef.current.srcObject = null;
        if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
        setChatLog((prev) => [...prev, { senderName: 'Sys', text: info.message, isSelf: false, isSys: true }])
        destroyPeerConnection()
      })

      socketInstance.on('you_got_banned', () => {
        setIsPartnerReconnecting(false)
        setIsStrangerBackgrounded(false)
        setBannedFlg(true)
        setIcePhase('idle')
        icePhaseRef.current = 'idle'
        stopAllMediaTracks()
        destroyPeerConnection()
      })
    }

    connectSocket();

    return () => {
      active = false;
      signalProcessorRef.current = null
      pendingSignalsRef.current = []
      if (socketInstance) {
        socketInstance.disconnect();
      }
      stopAllMediaTracks()
      destroyPeerConnection()
    }
  }, [initWebRTC, loadingAuth, showNetworkToast])

  const clickNext = () => {
    if (sockt) {
      if (dataChanRef.current && dataChanRef.current.readyState === 'open') {
        try { dataChanRef.current.send(JSON.stringify({ type: 'peer_left' })); } catch {
          /* ignore leave race */
        }
      }
      try { sockt.emit('leave_partner'); } catch {
        /* ignore leave race */
      }

      setIsPartnerReconnecting(false)
      setIsStrangerBackgrounded(false)
      setMatchStatus('searching')
      setIcePhase('searching')
      icePhaseRef.current = 'searching'
      setStrangerTyping(false)
      setStrangerCamActive(false)
      setStrangerNickname('Stranger');
      strangerNicknameRef.current = 'Stranger';
      setChatLog([{ senderName: 'Sys', text: 'Finding match...', isSelf: false, isSys: true }])

      destroyPeerConnection()
      sockt.emit('find_partner')
    }
  }

  const handleTyping = (e) => {
    setMsgInput(e.target.value);
    const now = Date.now();
    if (now - lastTypingSendRef.current > 400) {
      lastTypingSendRef.current = now;
      if (dataChanRef.current && dataChanRef.current.readyState === 'open') {
        dataChanRef.current.send(JSON.stringify({ type: 'typing' }));
      } else {
        pendingPeerPacketsRef.current.push({ type: 'typing' });
      }
    }
  }

  const handleEmojiClick = (emoji) => {
    setMsgInput((prev) => prev + emoji);
    setShowEmojiPicker(false);
  }

  const handleSend = (evt) => {
    evt.preventDefault()
    const sanitizedMsg = sanitizePeerMessage(msgInput);
    if (!sanitizedMsg) return;

    const sent = sendPeerPacket('msg', sanitizedMsg);
    if (!sent && pendingPeerPacketsRef.current.length >= 50) {
      return;
    }
    setChatLog((prev) => [...prev, { senderName: 'You', text: sanitizedMsg, isSelf: true, isSys: false }])
    setMsgInput('')
  }

  const handleReport = () => {
    if (sockt && matchStatus === 'connected') {
      if (window.confirm("Are you sure you want to report this stranger for inappropriate behavior?")) {
        sockt.emit('snitch_on_partner');
      }
    }
  }

  const handleLogout = () => {
    if (window.confirm("Are you sure you want to log out?")) {
      stopAllMediaTracks();
      destroyPeerConnection();
      logOut();
    }
  }

  const switchMic = async () => {
    if (!localStreamObj.current) {
        await initMedia(camActive, true);
        return;
    }
    let aTrack = localStreamObj.current.getAudioTracks()[0]
    if (aTrack) {
      aTrack.enabled = !aTrack.enabled
      setMicActive(aTrack.enabled)
      if (pcRef.current) {
        await syncLocalTracksToPeer();
        await renegotiatePeerAfterMediaChange();
      }
    } else {
      try {
        let newStream;
        try {
          newStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (firstErr) {
          if (firstErr.name === 'NotReadableError' || firstErr.name === 'TrackStartError') {
            await new Promise(res => setTimeout(res, 200));
            newStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          } else {
            throw firstErr;
          }
        }

        let newATrack = newStream.getAudioTracks()[0]
        localStreamObj.current.addTrack(newATrack)

        if (pcRef.current) {
          await syncLocalTracksToPeer();
          await renegotiatePeerAfterMediaChange();
        }
        setMicActive(true)
        setMediaError(null);
      } catch (e) {
        console.warn("[HARDWARE ERROR] switchMic failed:", e.name, e.message);
        setMediaError(e.name || 'Error');
      }
    }
  }

  const switchCam = async () => {
    if (!u) {
      try {
        const loggedInUser = await logInWithGoogle();
        if (loggedInUser) {
          await initMedia(true, micActive);
        }
        return; 
      } catch (e) {
        console.error("Login failed", e);
        return;
      }
    }

    if (!localStreamObj.current) {
        await initMedia(true, micActive);
        return;
    }

    if (camActive) {
      let vTrack = localStreamObj.current.getVideoTracks()[0]
      if (vTrack) {
        const useSoftwareMute = isMobileBrowser();

        if (useSoftwareMute) {
          vTrack.enabled = false;
        } else {
          try { vTrack.stop(); } catch {
            /* ignore camera cleanup race */
          }
          try { localStreamObj.current.removeTrack(vTrack); } catch {
            /* ignore stream cleanup race */
          }
        }

        if (pcRef.current) {
          const sender = getPeerSender('video');
          if (sender) {
            try { await sender.replaceTrack(useSoftwareMute ? vTrack : null); } catch {
              /* ignore track swap race */
            }
          }
        }
      }
      setCamActive(false)
      camActiveRef.current = false;
      if (dataChanRef.current && dataChanRef.current.readyState === 'open') {
        dataChanRef.current.send(JSON.stringify({ type: 'cam_toggle', payload: false }));
      }
      if (pcRef.current && sockt) {
        if (!isMobileBrowser()) {
          await renegotiatePeerAfterMediaChange();
        }
      }
    } else {
      try {
        let vTrack = localStreamObj.current?.getVideoTracks()[0];

        if (vTrack) {
          vTrack.enabled = true;
          if (pcRef.current) {
            const sender = getPeerSender('video');
            if (sender) {
              try { await sender.replaceTrack(vTrack); } catch {
                /* ignore track swap race */
              }
            }
          }
          setCamActive(true)
          camActiveRef.current = true;
          setMediaError(null);
          if (dataChanRef.current && dataChanRef.current.readyState === 'open') {
            dataChanRef.current.send(JSON.stringify({ type: 'cam_toggle', payload: true }));
          }
          if (pcRef.current && sockt) {
            await renegotiatePeerAfterMediaChange();
          }
          return;
        }

        let newStream;
        const getCamStream = async () => {
          try {
            return await navigator.mediaDevices.getUserMedia({ 
              video: { width: { ideal: 640, max: 1280 }, height: { ideal: 480, max: 720 }, frameRate: { ideal: 24, max: 30 } } 
            });
          } catch {
            return await navigator.mediaDevices.getUserMedia({ video: true });
          }
        };

        try {
          newStream = await getCamStream();
        } catch (firstErr) {
          if (firstErr.name === 'NotReadableError' || firstErr.name === 'TrackStartError') {
            await new Promise(res => setTimeout(res, 200));
            newStream = await navigator.mediaDevices.getUserMedia({ video: true });
          } else {
            throw firstErr;
          }
        }

        const newVTrack = newStream.getVideoTracks()[0]
        if (localStreamObj.current) {
          localStreamObj.current.addTrack(newVTrack);
        } else {
          localStreamObj.current = newStream;
        }

        if (selfVidRef.current) selfVidRef.current.srcObject = localStreamObj.current

        if (pcRef.current) {
          await syncLocalTracksToPeer();
          await renegotiatePeerAfterMediaChange();
        }

        setCamActive(true)
        camActiveRef.current = true;
        setMediaError(null);
        if (dataChanRef.current && dataChanRef.current.readyState === 'open') {
          dataChanRef.current.send(JSON.stringify({ type: 'cam_toggle', payload: true }));
        }
      } catch (e) {
        console.warn("[HARDWARE ERROR] switchCam failed:", e.name, e.message);
        setMediaError(e.name || 'Error');
      }
    }
  }

  if (!hasStarted) {
    return <LandingScreen onStart={(name) => {
      const safeName = sanitizeNickname(name, 'Stranger');
      setMyNickname(safeName);
      myNicknameRef.current = safeName;
      setHasStarted(true);
    }} />
  }

  if (loadingAuth) return <LoadingScreen />;
  if (bannedFlg) return <BannedScreen />;

  return (
    <div className="flex flex-col h-[100dvh] max-h-[100dvh] bg-neutral-950 text-white overflow-hidden">
      <Header 
        user={u} 
        onLogout={handleLogout} 
        onNext={clickNext} 
        socketReady={socketReady} 
        matchStatus={matchStatus} 
        onLogin={logInWithGoogle}
      />
      
      <main className="flex-1 flex flex-col xl:flex-row overflow-hidden">
        <VideoSection 
          user={u}
          onLogin={logInWithGoogle}
          remoteVidRef={remoteVidRef}
          remoteAudioRef={remoteAudioRef}
          selfVidRef={selfVidRef}
          matchStatus={matchStatus}
          icePhase={icePhase}
          mediaError={mediaError}
          onOpenPermissionsGuide={() => setMediaError('NotAllowedError')}
          strangerNickname={strangerNickname}
          myNickname={myNickname}
          strangerCamActive={strangerCamActive}
          camActive={camActive}
          micActive={micActive}
          isPartnerReconnecting={isPartnerReconnecting}
          isStrangerBackgrounded={isStrangerBackgrounded}
          onSwitchCam={switchCam}
          onSwitchMic={switchMic}
          onReport={handleReport}
        />
        
        <ChatBox 
          chatLog={chatLog}
          strangerTyping={strangerTyping}
          strangerNickname={strangerNickname}
          matchStatus={matchStatus}
          msgInput={msgInput}
          showEmojiPicker={showEmojiPicker}
          onTyping={handleTyping}
          onSend={handleSend}
          onToggleEmoji={() => setShowEmojiPicker(!showEmojiPicker)}
          onEmojiClick={handleEmojiClick}
        />
      </main>

      <MediaErrorModal 
        errorType={mediaError} 
        onRetry={() => initMedia(true, micActive)} 
        onContinueTextOnly={() => setMediaError(null)} 
      />

      <NetworkToast toast={networkToast} />

      <Analytics />
    </div>
  );
}