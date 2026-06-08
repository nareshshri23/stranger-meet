import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { auth, logInWithGoogle, logOut } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { Mic, MicOff, Video, VideoOff, LogOut, User, Smile } from 'lucide-react';

const SOKET_URL = 'https://stranger-meet-api.onrender.com'
const COMMON_EMOJIS = ["😀", "😂", "🥰", "😎", "😭", "🥺", "😡", "👍", "👎", "❤️", "🔥", "✨", "🎉", "💯", "🙏", "👋", "👀", "💀", "🤡", "👽"];

export default function App() {
  const [u, setU] = useState(null)
  const [loadingAuth, setLoadingAuth] = useState(true)
  const [bannedFlg, setBannedFlg] = useState(false)

  const [sockt, setSockt] = useState(null)
  const [socketReady, setSocketReady] = useState(false)
  const [matchStatus, setMatchStatus] = useState('idle') 
  const [chatLog, setChatLog] = useState([])
  const [msgInput, setMsgInput] = useState('')
  const [strangerTyping, setStrangerTyping] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)

  const [camActive, setCamActive] = useState(true)
  const [micActive, setMicActive] = useState(true)

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
    if (!u) return;

    let s_conn = io(SOKET_URL, { auth: { token: u.uid } })
    setSockt(s_conn)

    s_conn.on('connect', () => { setSocketReady(true) })
    s_conn.on('disconnect', () => { setSocketReady(false) })
    
    s_conn.on('connect_error', (err) => {
        console.error("rejected by srvr:", err.message);
        setBannedFlg(true);
        setSocketReady(false);
    });

    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then((s) => {
        localStreamObj.current = s
        if (selfVidRef.current) selfVidRef.current.srcObject = s
      })
      .catch((err) => {
        console.log("cam fail", err)
        alert("Plz allow camera")
      })

    s_conn.on('waiting', (data) => {
      setMatchStatus('searching')
      setChatLog([{ sender: 'sys', text: data.message }])
    })

    s_conn.on('matched', async (data) => {
      setMatchStatus('connected')
      setChatLog((prev) => [...prev, { sender: 'sys', text: 'Connected! Say hi' }])
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
      setChatLog((prev) => [...prev, { sender: 'sys', text: info.message }])
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
  }, [u])

  const attachDataEvents = (chan) => {
      chan.onmessage = (evt) => {
          try {
              const data = JSON.parse(evt.data);
              if (data.type === 'msg') {
                  setStrangerTyping(false);
                  setChatLog((prev) => [...prev, { sender: 'stranger', text: data.payload }]);
              } else if (data.type === 'typing') {
                  setStrangerTyping(true);
                  if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
                  typingTimeoutRef.current = setTimeout(() => {
                      setStrangerTyping(false);
                  }, 2000);
              }
          } catch(e) {
              setStrangerTyping(false);
              setChatLog((prev) => [...prev, { sender: 'stranger', text: evt.data }]);
          }
      }
  }

  const initWebRTC = async (isCaller, sockInstance) => {
      if (pcRef.current) pcRef.current.close()
      waitQueue.current = []

      // Secure, production-ready configuration using Vercel Environment Variables
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
          attachDataEvents(dChan)
      } else {
          peerCnn.ondatachannel = (evt) => {
              dataChanRef.current = evt.channel
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
      setChatLog([{ sender: 'sys', text: 'Finding match...' }])
      
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
    setChatLog((prev) => [...prev, { sender: 'you', text: msgInput }])
    setMsgInput('')
  }

  const switchMic = () => {
      if (localStreamObj.current) {
          let aTrack = localStreamObj.current.getAudioTracks()[0]
          if (aTrack) {
              aTrack.enabled = !aTrack.enabled
              setMicActive(aTrack.enabled)
          }
      }
  }

  const switchCam = async () => {
      let isMobileDev = /Mobi|Android/i.test(navigator.userAgent)

      if (camActive) {
          let vTrack = localStreamObj.current.getVideoTracks()[0]
          if (vTrack) {
              if (isMobileDev) vTrack.enabled = false
              else vTrack.stop()
          }
          setCamActive(false)
      } else {
          if (isMobileDev) {
              let vTrack = localStreamObj.current.getVideoTracks()[0]
              if (vTrack) vTrack.enabled = true
              setCamActive(true)
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
                  }
                  setCamActive(true)
              } catch (e) {
                  console.log("blocked", e)
                  alert("cam blocked")
              }
          }
      }
  }

  if (loadingAuth) return <div className="h-[100dvh] bg-neutral-950 flex items-center justify-center text-neutral-500">Loading...</div>
  
  if (bannedFlg) return (
      <div className="h-[100dvh] bg-neutral-950 flex flex-col items-center justify-center text-white p-4 text-center">
          <h1 className="text-4xl font-bold text-red-500 mb-4">BANNED</h1>
          <p className="text-neutral-400">Your Google Account has been blocked.</p>
      </div>
  )

  if (!u) return (
      <div className="h-[100dvh] bg-neutral-950 flex flex-col items-center justify-center text-white p-4">
          <div className="bg-neutral-900 border border-neutral-800 p-8 rounded-lg max-w-md w-full text-center shadow-2xl">
              <h1 className="text-2xl font-bold text-blue-500 mb-4">STRANGER_MEET</h1>
              <button onClick={logInWithGoogle} className="w-full flex items-center justify-center gap-3 px-6 py-3 rounded bg-white text-black font-semibold">
                  Login with Google
              </button>
          </div>
      </div>
  )

  return (
    <div className="flex flex-col h-[100dvh] max-h-[100dvh] bg-neutral-950 text-white overflow-hidden">
      <header className="p-3 md:p-4 bg-neutral-900 border-b border-neutral-800 flex justify-between items-center shrink-0">
        <h1 className="text-base md:text-xl font-bold text-blue-500">STRANGER_MEET</h1>
        <div className="flex items-center gap-3 md:gap-4">
          <div className="flex items-center gap-2 md:gap-3">
              <img src={u.photoURL} alt="pfp" className="hidden md:block w-8 h-8 rounded-full border border-neutral-700" />
              <button onClick={logOut} className="text-neutral-400 hover:text-red-400 p-2 md:p-1"><LogOut className="w-5 h-5" /></button>
          </div>
          <button
            onClick={clickNext}
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

      <main className="flex-1 flex flex-col md:flex-row overflow-hidden">
        <div className="relative w-full h-[40vh] md:h-auto md:flex-1 flex md:flex-row gap-2 p-2 bg-neutral-900 shrink-0">
          <div className="w-full h-full md:w-1/2 bg-black rounded-lg overflow-hidden border border-neutral-800 relative flex items-center justify-center">
            <video ref={remoteVidRef} autoPlay playsInline className="w-full h-full object-cover" />
            <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-0.5 rounded text-xs z-20">Stranger</div>
          </div>
          <div className="absolute bottom-4 right-4 w-24 h-36 md:relative md:w-1/2 md:h-full z-30 bg-neutral-800 rounded-lg overflow-hidden border border-neutral-600 shadow-2xl md:shadow-none flex items-center justify-center">
            <video ref={selfVidRef} autoPlay playsInline muted className={`w-full h-full object-cover transform -scale-x-100 ${!camActive ? 'hidden' : ''}`} />
            {!camActive && <div className="absolute inset-0 flex items-center justify-center bg-neutral-800"><User className="w-12 h-12 md:w-24 md:h-24 text-neutral-600" /></div>}
            <div className="absolute top-1 right-1 flex flex-col md:flex-row gap-1 z-10">
                <button onClick={switchMic} className="bg-neutral-900/80 p-1.5 rounded">{micActive ? <Mic className="w-4 h-4 text-white" /> : <MicOff className="w-4 h-4 text-red-500" />}</button>
                <button onClick={switchCam} className="bg-neutral-900/80 p-1.5 rounded">{camActive ? <Video className="w-4 h-4 text-white" /> : <VideoOff className="w-4 h-4 text-red-500" />}</button>
            </div>
          </div>
        </div>

        <div className="flex-1 md:flex-none w-full md:w-80 lg:w-96 flex flex-col border-t md:border-l border-neutral-800 bg-neutral-950 overflow-hidden min-h-[200px]">
          <div className="flex-1 p-3 overflow-y-auto space-y-2 text-sm">
            {chatLog.map((m, i) => (
              <div key={i} className={`p-2 rounded max-w-[85%] ${m.sender === 'sys' ? 'bg-neutral-900 text-neutral-400 mx-auto text-center text-xs' : m.sender === 'you' ? 'bg-blue-600 ml-auto' : 'bg-neutral-800'}`}>
                {m.sender !== 'sys' && <span className="block text-[10px] opacity-60 uppercase font-bold">{m.sender}</span>}
                {m.text}
              </div>
            ))}
            {strangerTyping && (
              <div className="text-xs text-neutral-500 italic p-2">Stranger is typing...</div>
            )}
          </div>
          <form onSubmit={handleSend} className="p-2 border-t border-neutral-800 flex gap-2 shrink-0 bg-neutral-950 mb-safe relative">
            {showEmojiPicker && (
                <div className="absolute bottom-14 left-2 bg-neutral-900 border border-neutral-700 rounded-lg p-2 grid grid-cols-5 gap-2 z-50 shadow-2xl">
                    {COMMON_EMOJIS.map(emoji => (
                        <button type="button" key={emoji} onClick={() => handleEmojiClick(emoji)} className="text-xl hover:bg-neutral-800 rounded p-1 transition-colors">
                            {emoji}
                        </button>
                    ))}
                </div>
            )}
            <button type="button" onClick={() => setShowEmojiPicker(!showEmojiPicker)} className="text-neutral-400 hover:text-white p-2 shrink-0">
                <Smile className="w-6 h-6" />
            </button>
            <input type="text" value={msgInput} onChange={handleTyping} disabled={matchStatus !== 'connected'} className="flex-1 bg-neutral-900 rounded px-3 py-2 text-white focus:outline-none" placeholder="Message..." />
            <button type="submit" disabled={matchStatus !== 'connected'} className="bg-blue-600 px-4 py-2 rounded font-semibold disabled:opacity-50 shrink-0">Send</button>
          </form>
        </div>
      </main>
    </div>
  )
}