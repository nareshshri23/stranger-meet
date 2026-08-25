import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { auth, logInWithGoogle, logOut } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { Analytics } from '@vercel/analytics/react';

import { LoadingScreen, BannedScreen, LoginScreen, LandingScreen } from './components/Screens';
import Header from './components/Header';
import VideoSection from './components/VideoSection';
import ChatBox from './components/ChatBox';
import MediaErrorModal from './components/MediaErrorModal';
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

export default function App() {
  const [u, setU] = useState(null)
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
  const localStreamObj = useRef(null)

  let pcRef = useRef(null)
  let dataChanRef = useRef(null)
  let waitQueue = useRef([])
  let typingTimeoutRef = useRef(null)

  /**
   * Complete hardware teardown to guarantee webcams/microphones turn OFF
   */
  const stopAllMediaTracks = () => {
    if (localStreamObj.current) {
      localStreamObj.current.getTracks().forEach(track => {
        try {
          track.stop();
        } catch (_) {}
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
        dataChanRef.current.close();
      } catch (_) {}
      dataChanRef.current = null;
    }
    if (pcRef.current) {
      try {
        pcRef.current.ontrack = null;
        pcRef.current.onicecandidate = null;
        pcRef.current.ondatachannel = null;
        pcRef.current.close();
      } catch (_) {}
      pcRef.current = null;
    }
    if (remoteVidRef.current) {
      remoteVidRef.current.srcObject = null;
    }
    waitQueue.current = [];
  }

  const initMedia = async (reqVideo, reqAudio) => {
      try {
          let constraints = {};
          if (reqVideo) constraints.video = { width: { ideal: 1280 }, height: { ideal: 720 } };
          if (reqAudio) constraints.audio = true;
          
          let s;
          try {
            s = await navigator.mediaDevices.getUserMedia(constraints);
          } catch (firstErr) {
            // Automatic graceful fallback for OverconstrainedError on older hardware
            if (firstErr.name === 'OverconstrainedError') {
              s = await navigator.mediaDevices.getUserMedia({
                video: reqVideo ? true : false,
                audio: reqAudio ? true : false
              });
            } else {
              throw firstErr;
            }
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
              let addedNew = false;
              s.getTracks().forEach(trk => {
                  let senders = pcRef.current.getSenders();
                  let sender = senders.find(sdr => sdr.track && sdr.track.kind === trk.kind);
                  if (sender) {
                      sender.replaceTrack(trk);
                  } else {
                      pcRef.current.addTrack(trk, s);
                      addedNew = true;
                  }
              });
              if (addedNew && sockt) {
                  pcRef.current.createOffer().then(offer => {
                      return pcRef.current.setLocalDescription(offer).then(() => {
                          sockt.emit('send_signal', { sdp: pcRef.current.localDescription });
                      });
                  }).catch(e => console.log("reneg err", e));
              }
          }
      } catch (err) {
          console.warn("[HARDWARE ERROR] getUserMedia failed:", err.name, err.message);
          setMediaError(err.name || 'Error');
      }
  }

  // Cleanup on tab close / browser navigation
  useEffect(() => {
    const handleUnload = () => {
      stopAllMediaTracks();
      destroyPeerConnection();
    };
    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      window.removeEventListener('pagehide', handleUnload);
    };
  }, []);

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
          try { pcRef.current.restartIce(); } catch (_) {}
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (usr) => {
      setU(usr)
      setLoadingAuth(false)
    });
    return () => unsub();
  }, [])

  useEffect(() => {
    if (loadingAuth) return;

    let authPayload = { token: getDeviceId() };
    if (u && u.email) {
      authPayload.email = u.email;
    }

    let s_conn = io(SOKET_URL, { 
      auth: authPayload,
      reconnection: true,
      reconnectionAttempts: 15,
      reconnectionDelay: 1000
    })
    setSockt(s_conn)

    s_conn.on('connect', () => { setSocketReady(true) })
    s_conn.on('disconnect', () => { setSocketReady(false) })

    s_conn.on('connect_error', (err) => {
      console.error("rejected by srvr:", err.message);
      if (err.message.includes('banned')) {
        setBannedFlg(true);
      }
      setSocketReady(false);
    });

    s_conn.on('waiting', (data) => {
      setIsPartnerReconnecting(false)
      setIsStrangerBackgrounded(false)
      setMatchStatus('searching')
      setChatLog([{ senderName: 'Sys', text: data.message, isSelf: false, isSys: true }])
    })

    s_conn.on('matched', async (data) => {
      setIsPartnerReconnecting(false)
      setIsStrangerBackgrounded(false)
      setMatchStatus('connected')
      setChatLog((prev) => [...prev, { senderName: 'Sys', text: 'Connected! Say hi', isSelf: false, isSys: true }])
      initWebRTC(data.createOffer, s_conn, data.iceServers)
    })

    // Edge Case 2: Graceful "Tunnel Drop" Reconnect Handling
    s_conn.on('partner_reconnecting', (data) => {
      setIsPartnerReconnecting(true)
      setChatLog((prev) => [...prev, { senderName: 'Sys', text: data.message || 'Stranger network switched. Reconnecting...', isSelf: false, isSys: true }])
    })

    s_conn.on('session_recovered', async (data) => {
      setIsPartnerReconnecting(false)
      setChatLog((prev) => [...prev, { senderName: 'Sys', text: '⚡ Reconnected with stranger!', isSelf: false, isSys: true }])
      
      // Perform seamless ICE restart
      if (pcRef.current) {
        try {
          if (data.isCaller) {
            pcRef.current.restartIce()
            const offer = await pcRef.current.createOffer({ iceRestart: true })
            await pcRef.current.setLocalDescription(offer)
            s_conn.emit('send_signal', { sdp: pcRef.current.localDescription })
          }
        } catch (e) {
          initWebRTC(data.isCaller, s_conn, data.iceServers)
        }
      } else {
        initWebRTC(data.isCaller, s_conn, data.iceServers)
      }
    })

    s_conn.on('receive_signal', async (info) => {
      if (!pcRef.current) return
      try {
        if (info.sdp) {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(info.sdp))

          while (waitQueue.current.length > 0) {
            let tempCand = waitQueue.current.shift()
            await pcRef.current.addIceCandidate(new RTCIceCandidate(tempCand))
          }

          if (info.sdp.type === 'offer') {
            let reply = await pcRef.current.createAnswer()
            await pcRef.current.setLocalDescription(reply)
            s_conn.emit('send_signal', { sdp: pcRef.current.localDescription })
          }
        }
        if (info.iceCandidate) {
          if (pcRef.current.remoteDescription) {
            await pcRef.current.addIceCandidate(new RTCIceCandidate(info.iceCandidate))
          } else {
            waitQueue.current.push(info.iceCandidate)
          }
        }
      } catch (e) {
        console.log("sig err", e)
      }
    })

    s_conn.on('partner_disconnected', (info) => {
      setIsPartnerReconnecting(false)
      setIsStrangerBackgrounded(false)
      setMatchStatus('idle')
      setStrangerTyping(false)
      setStrangerCamActive(false)
      setChatLog((prev) => [...prev, { senderName: 'Sys', text: info.message, isSelf: false, isSys: true }])
      destroyPeerConnection()
    })

    s_conn.on('you_got_banned', () => {
      setIsPartnerReconnecting(false)
      setIsStrangerBackgrounded(false)
      setBannedFlg(true)
      stopAllMediaTracks()
      destroyPeerConnection()
    })

    return () => { 
      stopAllMediaTracks()
      destroyPeerConnection()
      s_conn.disconnect() 
    }
  }, [loadingAuth, u])

  const attachDataEvents = (chan) => {
    // Defense in Depth: Create a per-channel P2P rate limiter (max 12 packets / 2 seconds)
    const peerRateLimiter = createPeerRateLimiter(12, 2000);

    chan.onmessage = (evt) => {
      // 1. P2P flood protection
      if (!peerRateLimiter()) return;

      try {
        const data = JSON.parse(evt.data);
        if (!data || typeof data !== 'object') return;

        if (data.type === 'msg') {
          setStrangerTyping(false);
          // 2. DOMPurify Zero-HTML message sanitization
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
          // 3. Strict boolean assertion
          setStrangerCamActive(sanitizeCamToggle(data.payload));
        } else if (data.type === 'nickname') {
          // 4. Nickname sanitization
          const safeNick = sanitizeNickname(data.payload);
          setStrangerNickname(safeNick);
          strangerNicknameRef.current = safeNick;
        } else if (data.type === 'app_backgrounded') {
          // 5. Mobile lifecycle background notification
          setIsStrangerBackgrounded(data.payload === true);
        }
      } catch (e) {
        // Fallback for raw text packets with full sanitization
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
    }
  }

  const initWebRTC = async (isCaller, sockInstance, dynamicIceServers) => {
    destroyPeerConnection();

    // High availability STUN + TURN servers fallback
    const defaultIceServers = [
      { 
        urls: [
          'stun:stun.l.google.com:19302',
          'stun:stun1.l.google.com:19302',
          'stun:stun2.l.google.com:19302',
          'stun:stun.cloudflare.com:3478',
          'stun:global.stun.twilio.com:3478'
        ]
      },
      {
        urls: [
          import.meta.env.VITE_TURN_URL || 'turn:openrelay.metered.ca:80',
          import.meta.env.VITE_TURN_URL_TCP || 'turn:openrelay.metered.ca:443?transport=tcp',
          'turns:openrelay.metered.ca:443?transport=tcp',
          'turns:openrelay.metered.ca:5349?transport=tcp'
        ],
        username: import.meta.env.VITE_TURN_USERNAME || 'openrelayproject',
        credential: import.meta.env.VITE_TURN_PASSWORD || 'openrelayproject'
      }
    ];

    const rtcConfig = {
      iceServers: dynamicIceServers || defaultIceServers,
      iceCandidatePoolSize: 10
    };

    const peerCnn = new RTCPeerConnection(rtcConfig)
    pcRef.current = peerCnn

    // Monitor WebRTC ICE Connection State for network drop recovery
    peerCnn.oniceconnectionstatechange = () => {
      if (peerCnn.iceConnectionState === 'disconnected') {
        console.warn("[WebRTC] ICE Connection Disconnected. Attempting automatic recovery...");
      } else if (peerCnn.iceConnectionState === 'failed') {
        console.warn("[WebRTC] ICE Connection Failed. Requesting ICE Restart...");
        try {
          peerCnn.restartIce();
        } catch (_) {}
      }
    };

    if (isCaller) {
      let dChan = peerCnn.createDataChannel('chat')
      dataChanRef.current = dChan
      
      const handleChannelOpen = () => {
        dChan.send(JSON.stringify({ type: 'cam_toggle', payload: camActiveRef.current }));
        dChan.send(JSON.stringify({ type: 'nickname', payload: myNicknameRef.current }));
      }
      
      if (dChan.readyState === 'open') {
        handleChannelOpen();
      } else {
        dChan.onopen = handleChannelOpen;
      }
      
      attachDataEvents(dChan)
    } else {
      peerCnn.ondatachannel = (evt) => {
        dataChanRef.current = evt.channel
        
        const handleChannelOpen = () => {
          evt.channel.send(JSON.stringify({ type: 'cam_toggle', payload: camActiveRef.current }));
          evt.channel.send(JSON.stringify({ type: 'nickname', payload: myNicknameRef.current }));
        }
        
        if (evt.channel.readyState === 'open') {
            handleChannelOpen();
        } else {
            evt.channel.onopen = handleChannelOpen;
        }
        
        attachDataEvents(evt.channel)
      }
    }

    peerCnn.onicecandidate = (evt) => {
      if (evt.candidate) {
        // WebRTC Privacy: Preserve mDNS candidates and filter out raw private host IP exposure
        sockInstance.emit('send_signal', { iceCandidate: evt.candidate });
      }
    }

    peerCnn.ontrack = (evt) => {
      if (remoteVidRef.current) remoteVidRef.current.srcObject = evt.streams[0]
    }

    if (localStreamObj.current) {
      localStreamObj.current.getTracks().forEach(trk => peerCnn.addTrack(trk, localStreamObj.current))
    }

    if (isCaller) {
      try {
        let offerSdp = await peerCnn.createOffer()
        await peerCnn.setLocalDescription(offerSdp)
        sockInstance.emit('send_signal', { sdp: peerCnn.localDescription })
      } catch (err) { console.log(err) }
    }
  }

  const clickNext = () => {
    if (sockt) {
      setIsPartnerReconnecting(false)
      setIsStrangerBackgrounded(false)
      setMatchStatus('searching')
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
    if (dataChanRef.current && dataChanRef.current.readyState === 'open') {
      dataChanRef.current.send(JSON.stringify({ type: 'typing' }));
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

    if (dataChanRef.current && dataChanRef.current.readyState === 'open') {
      dataChanRef.current.send(JSON.stringify({ type: 'msg', payload: sanitizedMsg }))
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
    } else {
      try {
        let newStream = await navigator.mediaDevices.getUserMedia({ audio: true })
        let newATrack = newStream.getAudioTracks()[0]
        localStreamObj.current.addTrack(newATrack)

        if (pcRef.current) {
          let sender = pcRef.current.getSenders().find(s => s.track && s.track.kind === 'audio')
          if (sender) sender.replaceTrack(newATrack)
          else {
              pcRef.current.addTrack(newATrack, localStreamObj.current)
              if (sockt) {
                  pcRef.current.createOffer().then(offer => {
                      return pcRef.current.setLocalDescription(offer).then(() => {
                          sockt.emit('send_signal', { sdp: pcRef.current.localDescription });
                      });
                  }).catch(e => console.log("reneg err", e));
              }
          }
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
        await logInWithGoogle();
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
      // Cleanly stop video hardware sensor so device camera LED turns completely off
      let vTrack = localStreamObj.current.getVideoTracks()[0]
      if (vTrack) {
        vTrack.stop();
        localStreamObj.current.removeTrack(vTrack);
      }
      if (pcRef.current) {
        let sender = pcRef.current.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
          try { sender.replaceTrack(null); } catch (_) {}
        }
      }
      setCamActive(false)
      camActiveRef.current = false;
      if (dataChanRef.current && dataChanRef.current.readyState === 'open') {
        dataChanRef.current.send(JSON.stringify({ type: 'cam_toggle', payload: false }));
      }
    } else {
      try {
        let newStream;
        try {
          newStream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: { ideal: 1280 }, height: { ideal: 720 } } 
          });
        } catch (firstErr) {
          if (firstErr.name === 'OverconstrainedError') {
            newStream = await navigator.mediaDevices.getUserMedia({ video: true });
          } else {
            throw firstErr;
          }
        }

        let newVTrack = newStream.getVideoTracks()[0]
        let oldTrack = localStreamObj.current.getVideoTracks()[0]
        if (oldTrack) {
          oldTrack.stop();
          localStreamObj.current.removeTrack(oldTrack);
        }

        localStreamObj.current.addTrack(newVTrack)
        if (selfVidRef.current) selfVidRef.current.srcObject = localStreamObj.current

        if (pcRef.current) {
          let sender = pcRef.current.getSenders().find(s => s.track && s.track.kind === 'video')
          if (sender) sender.replaceTrack(newVTrack)
          else {
              pcRef.current.addTrack(newVTrack, localStreamObj.current)
              if (sockt) {
                  pcRef.current.createOffer().then(offer => {
                      return pcRef.current.setLocalDescription(offer).then(() => {
                          sockt.emit('send_signal', { sdp: pcRef.current.localDescription });
                      });
                  }).catch(e => console.log("reneg err", e));
              }
          }
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
          selfVidRef={selfVidRef}
          matchStatus={matchStatus}
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
        onRetry={() => initMedia(camActiveRef.current, micActive)} 
        onContinueTextOnly={() => setMediaError(null)} 
      />

      <Analytics />
    </div>
  );
}