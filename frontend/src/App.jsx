import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { auth, logInWithGoogle, logOut } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';

import { LoadingScreen, BannedScreen, LoginScreen, LandingScreen } from './components/Screens';
import Header from './components/Header';
import VideoSection from './components/VideoSection';
import ChatBox from './components/ChatBox';

const SOKET_URL = 'https://stranger-meet-api.onrender.com'

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
  const [chatLog, setChatLog] = useState([])
  const [msgInput, setMsgInput] = useState('')
  const [strangerTyping, setStrangerTyping] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [strangerCamActive, setStrangerCamActive] = useState(false)

  const [camActive, setCamActive] = useState(false)
  const [micActive, setMicActive] = useState(false)
  const camActiveRef = useRef(false)

  const initMedia = async (reqVideo, reqAudio) => {
      try {
          let s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
          localStreamObj.current = s
          
          let vTrack = s.getVideoTracks()[0]
          if (vTrack) vTrack.enabled = reqVideo;
          
          let aTrack = s.getAudioTracks()[0]
          if (aTrack) aTrack.enabled = reqAudio;

          if (selfVidRef.current) selfVidRef.current.srcObject = s
          
          setCamActive(reqVideo)
          camActiveRef.current = reqVideo
          setMicActive(reqAudio)

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
          console.log("cam fail", err)
          alert("Please allow camera and microphone access.")
      }
  }

  const selfVidRef = useRef(null)
  const remoteVidRef = useRef(null)
  const localStreamObj = useRef(null)

  let pcRef = useRef(null)
  let dataChanRef = useRef(null)
  let waitQueue = useRef([])
  let typingTimeoutRef = useRef(null)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (usr) => {
      setU(usr)
      setLoadingAuth(false)
    });
    return () => unsub();
  }, [])

  useEffect(() => {
    let s_conn = io(SOKET_URL, { auth: { token: getDeviceId() } })
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
      setMatchStatus('searching')
      setChatLog([{ senderName: 'Sys', text: data.message, isSelf: false, isSys: true }])
    })

    s_conn.on('matched', async (data) => {
      setMatchStatus('connected')
      setChatLog((prev) => [...prev, { senderName: 'Sys', text: 'Connected! Say hi', isSelf: false, isSys: true }])
      initWebRTC(data.createOffer, s_conn)
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
      setMatchStatus('idle')
      setStrangerTyping(false)
      setStrangerCamActive(false)
      setChatLog((prev) => [...prev, { senderName: 'Sys', text: info.message, isSelf: false, isSys: true }])
      if (remoteVidRef.current) remoteVidRef.current.srcObject = null
      if (pcRef.current) {
        pcRef.current.close()
        pcRef.current = null
      }
      dataChanRef.current = null
      waitQueue.current = []
    })

    s_conn.on('you_got_banned', () => {
      setBannedFlg(true)
      if (localStreamObj.current) localStreamObj.current.getTracks().forEach(t => t.stop())
    })

    return () => { s_conn.disconnect() }
  }, [])

  const attachDataEvents = (chan) => {
    chan.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        if (data.type === 'msg') {
          setStrangerTyping(false);
          setChatLog((prev) => [...prev, { senderName: strangerNicknameRef.current, text: data.payload, isSelf: false, isSys: false }]);
        } else if (data.type === 'typing') {
          setStrangerTyping(true);
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = setTimeout(() => {
            setStrangerTyping(false);
          }, 2000);
        } else if (data.type === 'cam_toggle') {
          setStrangerCamActive(data.payload);
        } else if (data.type === 'nickname') {
          setStrangerNickname(data.payload);
          strangerNicknameRef.current = data.payload;
        }
      } catch (e) {
        setStrangerTyping(false);
        setChatLog((prev) => [...prev, { senderName: strangerNicknameRef.current, text: evt.data, isSelf: false, isSys: false }]);
      }
    }
  }

  const initWebRTC = async (isCaller, sockInstance) => {
    if (pcRef.current) pcRef.current.close()
    waitQueue.current = []

    let rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        {
          urls: [
            'turn:free.expressturn.com:3478?transport=udp',
            'turn:free.expressturn.com:3478?transport=tcp'
          ],
          username: import.meta.env.VITE_TURN_USERNAME,
          credential: import.meta.env.VITE_TURN_PASSWORD
        }
      ]
    }

    const peerCnn = new RTCPeerConnection(rtcConfig)
    pcRef.current = peerCnn

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
      if (evt.candidate) sockInstance.emit('send_signal', { iceCandidate: evt.candidate })
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
      setMatchStatus('searching')
      setStrangerTyping(false)
      setStrangerCamActive(false)
      setStrangerNickname('Stranger');
      strangerNicknameRef.current = 'Stranger';
      setChatLog([{ senderName: 'Sys', text: 'Finding match...', isSelf: false, isSys: true }])

      if (remoteVidRef.current) remoteVidRef.current.srcObject = null
      if (pcRef.current) {
        pcRef.current.close()
        pcRef.current = null
      }
      dataChanRef.current = null
      waitQueue.current = []

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
    if (!msgInput.trim()) return
    if (dataChanRef.current && dataChanRef.current.readyState === 'open') {
      dataChanRef.current.send(JSON.stringify({ type: 'msg', payload: msgInput }))
    }
    setChatLog((prev) => [...prev, { senderName: 'You', text: msgInput, isSelf: true, isSys: false }])
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
      logOut();
    }
  }

  const switchMic = async () => {
    if (!localStreamObj.current) {
        await initMedia(camActive, true);
        return;
    }
    if (localStreamObj.current) {
      let aTrack = localStreamObj.current.getAudioTracks()[0]
      if (aTrack) {
        aTrack.enabled = !aTrack.enabled
        setMicActive(aTrack.enabled)
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
    let isMobileDev = /Mobi|Android/i.test(navigator.userAgent)

    if (camActive) {
      let vTrack = localStreamObj.current.getVideoTracks()[0]
      if (vTrack) {
        if (isMobileDev) vTrack.enabled = false
        else vTrack.stop()
      }
      setCamActive(false)
      camActiveRef.current = false;
      if (dataChanRef.current && dataChanRef.current.readyState === 'open') {
        dataChanRef.current.send(JSON.stringify({ type: 'cam_toggle', payload: false }));
      }
    } else {
      if (isMobileDev) {
        let vTrack = localStreamObj.current.getVideoTracks()[0]
        if (vTrack) vTrack.enabled = true
        setCamActive(true)
        camActiveRef.current = true;
        if (dataChanRef.current && dataChanRef.current.readyState === 'open') {
          dataChanRef.current.send(JSON.stringify({ type: 'cam_toggle', payload: true }));
        }
      } else {
        try {
          let newStream = await navigator.mediaDevices.getUserMedia({ video: true })
          let newVTrack = newStream.getVideoTracks()[0]

          let oldTrack = localStreamObj.current.getVideoTracks()[0]
          if (oldTrack) localStreamObj.current.removeTrack(oldTrack)

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
          if (dataChanRef.current && dataChanRef.current.readyState === 'open') {
            dataChanRef.current.send(JSON.stringify({ type: 'cam_toggle', payload: true }));
          }
        } catch (e) {
          console.log("blocked", e)
          alert("cam blocked")
        }
      }
    }
  }

  if (!hasStarted) {
    return <LandingScreen onStart={(name) => {
      setMyNickname(name);
      myNicknameRef.current = name;
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
    </div>
  );
}