import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { auth, logInWithGoogle, logOut } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';

const SOKET_URL = 'https://stranger-meet-api.onrender.com' // Change to your Render URL for production

export default function App() {
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [am_i_banned, set_am_i_banned] = useState(false)

  const [sock, setSock] = useState(null)
  const [currState, setCurrState] = useState('idle') 
  const [msgs, setMsgs] = useState([])
  const [txt, setTxt] = useState('')
  
  const [isMicOn, setIsMicOn] = useState(true)
  const [isCamOn, setIsCamOn] = useState(true)

  const myVid = useRef(null)
  const otherVid = useRef(null)
  const myStream = useRef(null)
  let rtc_conn = useRef(null) 
  let dc_ref = useRef(null)

  // 1. Listen for Google Login State
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
        setUser(currentUser)
        setAuthLoading(false)
    });
    return () => unsubscribe();
  }, [])

  // 2. Only connect to socket if a real Google User exists
  useEffect(() => {
    if (!user) return;

    // We pass the secure Google UID as the token to our backend!
    let s = io(SOKET_URL, {
        auth: { token: user.uid }
    })
    setSock(s)

    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then((streamData) => {
        myStream.current = streamData
        if (myVid.current) {
          myVid.current.srcObject = streamData
        }
      })
      .catch((e) => {
        console.error("camera err:", e)
        alert("Camera required for this app.")
      })

    s.on('waiting', (d) => {
      setCurrState('searching')
      setMsgs([{ sender: 'system', text: d.message }])
    })

    s.on('matched', async (d) => {
      setCurrState('connected')
      setMsgs((old) => [...old, { sender: 'system', text: 'Connected to a stranger. Say hi!' }])
      makeWebRTC(d.createOffer, s)
    })

    s.on('receive_signal', async (data) => {
      if (!rtc_conn.current) return 
      try {
          if (data.sdp) {
              await rtc_conn.current.setRemoteDescription(new RTCSessionDescription(data.sdp))
              if (data.sdp.type === 'offer') {
                  let ans = await rtc_conn.current.createAnswer()
                  await rtc_conn.current.setLocalDescription(ans)
                  s.emit('send_signal', { sdp: rtc_conn.current.localDescription })
              }
          }
          if (data.iceCandidate) {
              await rtc_conn.current.addIceCandidate(new RTCIceCandidate(data.iceCandidate))
          }
      } catch (err) { }
    })

    s.on('partner_disconnected', (d) => {
      setCurrState('idle')
      setMsgs((old) => [...old, { sender: 'system', text: d.message }])
      if (otherVid.current) otherVid.current.srcObject = null
      if (rtc_conn.current) {
          rtc_conn.current.close()
          rtc_conn.current = null
      }
      dc_ref.current = null
    })

    s.on('you_got_banned', (d) => {
        set_am_i_banned(true)
        if (myStream.current) {
            myStream.current.getTracks().forEach(t => t.stop())
        }
    })

    return () => {
      s.disconnect()
    }
  }, [user]) // Re-run this hook when the 'user' object changes

  const hook_up_data_pipe = (pipe) => {
      pipe.onmessage = (event) => {
          setMsgs((old) => [...old, { sender: 'stranger', text: event.data }])
      }
  }

  const makeWebRTC = async (isInitiator, socketInstance) => {
      if (rtc_conn.current) rtc_conn.current.close()

      let config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
      const pc = new RTCPeerConnection(config)
      rtc_conn.current = pc

      if (isInitiator) {
          let p = pc.createDataChannel('chat_pipe')
          dc_ref.current = p
          hook_up_data_pipe(p)
      } else {
          pc.ondatachannel = (event) => {
              dc_ref.current = event.channel
              hook_up_data_pipe(event.channel)
          }
      }

      pc.onicecandidate = (e) => {
          if (e.candidate) socketInstance.emit('send_signal', { iceCandidate: e.candidate })
      }

      pc.ontrack = (e) => {
          if (otherVid.current) otherVid.current.srcObject = e.streams[0]
      }

      if (myStream.current) {
          myStream.current.getTracks().forEach(t => pc.addTrack(t, myStream.current))
      }

      if (isInitiator) {
          try {
              let sdp = await pc.createOffer()
              await pc.setLocalDescription(sdp)
              socketInstance.emit('send_signal', { sdp: pc.localDescription })
          } catch (e) { }
      }
  }

  const handleNextBtn = () => {
    if (sock) {
      setMsgs([])
      if (otherVid.current) otherVid.current.srcObject = null
      if (rtc_conn.current) {
          rtc_conn.current.close()
          rtc_conn.current = null
      }
      dc_ref.current = null
      sock.emit('find_partner')
    }
  }

  const triggerReport = () => {
      let sure = window.confirm("Report this user for inappropriate behavior? They will be disconnected and banned.")
      if (sure && sock) {
          sock.emit('snitch_on_partner')
          setMsgs((old) => [...old, { sender: 'system', text: 'User reported and blocked.' }])
          setCurrState('idle')
          if (otherVid.current) otherVid.current.srcObject = null
          if (rtc_conn.current) {
              rtc_conn.current.close()
              rtc_conn.current = null
          }
      }
  }

  const sendMsg = (e) => {
    e.preventDefault()
    if (!txt.trim()) return
    if (dc_ref.current && dc_ref.current.readyState === 'open') {
        dc_ref.current.send(txt)
    }
    setMsgs((old) => [...old, { sender: 'you', text: txt }])
    setTxt('')
  }

  const toggleMic = () => {
      if (myStream.current) {
          let track = myStream.current.getAudioTracks()[0]
          if (track) {
              track.enabled = !track.enabled
              setIsMicOn(track.enabled)
          }
      }
  }

  const toggleCam = () => {
      if (myStream.current) {
          let track = myStream.current.getVideoTracks()[0]
          if (track) {
              track.enabled = !track.enabled
              setIsCamOn(track.enabled)
          }
      }
  }

  // --- RENDER BLOCKERS ---

  if (authLoading) {
      return <div className="h-screen bg-neutral-950 flex items-center justify-center text-neutral-500">Loading App...</div>
  }

  if (am_i_banned) {
      return (
          <div className="h-screen bg-neutral-950 flex flex-col items-center justify-center text-white p-4 text-center">
              <h1 className="text-4xl font-bold text-red-500 mb-4">ACCESS DENIED</h1>
              <p className="text-neutral-400 max-w-md">Your Google Account has been permanently banned from this platform due to multiple reports of terms of service violations.</p>
          </div>
      )
  }

  if (!user) {
      return (
          <div className="h-screen bg-neutral-950 flex flex-col items-center justify-center text-white p-4">
              <div className="bg-neutral-900 border border-neutral-800 p-8 rounded-lg max-w-md text-center shadow-2xl">
                  <h1 className="text-2xl font-bold text-blue-500 mb-4">STRANGER_MEET</h1>
                  <h2 className="text-lg font-semibold mb-4 text-neutral-300">Accountability Required</h2>
                  <p className="text-neutral-400 text-sm mb-8 leading-relaxed">
                      To ensure a safe environment and maintain legal compliance, anonymous access is strictly prohibited. You must authenticate with a verified Google account to enter the matchmaking queue.
                  </p>
                  <button onClick={logInWithGoogle} className="w-full flex items-center justify-center gap-3 px-6 py-3 rounded bg-white hover:bg-neutral-200 text-black font-semibold transition-colors">
                      <img src="https://www.svgrepo.com/show/475656/google-color.svg" className="w-5 h-5" alt="Google" />
                      Sign in with Google
                  </button>
              </div>
          </div>
      )
  }

  // --- MAIN APP RENDER ---

  return (
    <div className="flex flex-col h-screen max-h-screen bg-neutral-950 text-white">
      <header className="p-4 bg-neutral-900 border-b border-neutral-800 flex justify-between items-center">
        <h1 className="text-xl font-bold text-blue-500 tracking-wide">STRANGER_MEET</h1>
        
        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-2 mr-4">
              <img src={user.photoURL} alt="avatar" className="w-8 h-8 rounded-full border border-neutral-700" />
              <button onClick={logOut} className="text-xs text-neutral-500 hover:text-red-400 transition-colors">Logout</button>
          </div>

          <span className="text-xs bg-neutral-800 px-3 py-1.5 rounded-full text-neutral-400 font-mono hidden md:inline-block">
            Status: <span className="text-emerald-400 capitalize">{currState}</span>
          </span>
          
          {currState === 'connected' && (
              <button onClick={triggerReport} className="px-3 py-1.5 text-xs font-bold rounded bg-red-900/50 text-red-400 border border-red-800 hover:bg-red-800 hover:text-white transition-colors">
                  Report
              </button>
          )}

          <button
            onClick={handleNextBtn}
            className={`px-5 py-1.5 font-semibold rounded transition-colors ${
              currState === 'connected' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {currState === 'idle' && 'Start Chatting'}
            {currState === 'searching' && 'Skip Waiting'}
            {currState === 'connected' && 'Next Stranger'}
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col md:flex-row overflow-hidden">
        <div className="flex-1 grid grid-rows-2 md:grid-rows-1 md:grid-cols-2 gap-2 p-2 bg-neutral-900">
          <div className="relative bg-black rounded-lg overflow-hidden border border-neutral-800 flex items-center justify-center">
            <video ref={myVid} autoPlay playsInline muted className="w-full h-full object-cover transform -scale-x-100" />
            <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-0.5 rounded text-xs">You</div>
            
            <div className="absolute top-2 right-2 flex gap-2">
                <button onClick={toggleMic} className="bg-neutral-800/80 hover:bg-neutral-700 px-2 py-1 rounded text-xs border border-neutral-700 transition-colors">
                    {isMicOn ? '🎙️ Mic On' : '🔇 Mic Off'}
                </button>
                <button onClick={toggleCam} className="bg-neutral-800/80 hover:bg-neutral-700 px-2 py-1 rounded text-xs border border-neutral-700 transition-colors">
                    {isCamOn ? '📷 Cam On' : '🚫 Cam Off'}
                </button>
            </div>
          </div>
          <div className="relative bg-black rounded-lg overflow-hidden border border-neutral-800 flex items-center justify-center">
            <video ref={otherVid} autoPlay playsInline className="w-full h-full object-cover" />
            <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-0.5 rounded text-xs">Stranger</div>
            {currState === 'searching' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-sm animate-pulse text-neutral-400">
                Finding a stranger online...
              </div>
            )}
            {currState === 'idle' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-sm text-neutral-500">
                Click "Start Chatting" to begin.
              </div>
            )}
          </div>
        </div>

        <div className="w-full h-64 md:h-auto md:w-96 flex flex-col border-t md:border-t-0 md:border-l border-neutral-800 bg-neutral-950">
          <div className="flex-1 p-4 overflow-y-auto space-y-2 text-sm">
            {msgs.map((msg, i) => (
              <div key={i} className={`p-2 rounded max-w-[85%] ${
                msg.sender === 'system' ? 'bg-neutral-900 text-neutral-400 mx-auto text-center text-xs w-full' :
                msg.sender === 'you' ? 'bg-blue-600 text-white ml-auto' : 'bg-neutral-800 text-white'
              }`}>
                {msg.sender !== 'system' && <span className="block text-[10px] opacity-60 uppercase font-bold">{msg.sender}</span>}
                {msg.text}
              </div>
            ))}
          </div>

          <form onSubmit={sendMsg} className="p-3 border-t border-neutral-800 flex gap-2">
            <input
              type="text"
              value={txt}
              onChange={(e) => setTxt(e.target.value)}
              disabled={currState !== 'connected'}
              placeholder={currState === 'connected' ? "Type a message..." : "Connect to a stranger first..."}
              className="flex-1 bg-neutral-900 border border-neutral-800 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={currState !== 'connected'}
              className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-sm font-semibold disabled:opacity-50 transition-colors"
            >
              Send
            </button>
          </form>
        </div>
      </main>
    </div>
  )
}