import React, { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { auth, logInWithGoogle, logOut } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';

const SOKET_URL = 'https://stranger-meet-api.onrender.com' // Your live backend URL

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

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
        setUser(currentUser)
        setAuthLoading(false)
    });
    return () => unsubscribe();
  }, [])

  useEffect(() => {
    if (!user) return;

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
  }, [user])

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

  const toggleCam = async () => {
      let is_phn = /Mobi|Android/i.test(navigator.userAgent)

      if (isCamOn) {
          let trk = myStream.current.getVideoTracks()[0]
          if (trk) {
              if (is_phn) {
                  trk.enabled = false
              } else {
                  trk.stop()
              }
          }
          setIsCamOn(false)
      } else {
          if (is_phn) {
              let curr_trk = myStream.current.getVideoTracks()[0]
              if (curr_trk) curr_trk.enabled = true
              setIsCamOn(true)
          } else {
              try {
                  let fresh_vid = await navigator.mediaDevices.getUserMedia({ video: true })
                  let n_trk = fresh_vid.getVideoTracks()[0]
                  
                  let prev_t = myStream.current.getVideoTracks()[0]
                  if (prev_t) myStream.current.removeTrack(prev_t)
                  myStream.current.addTrack(n_trk)
                  
                  if (myVid.current) {
                      myVid.current.srcObject = myStream.current
                  }
                  
                  if (rtc_conn.current) {
                      let vsndr = rtc_conn.current.getSenders().find(s => s.track && s.track.kind === 'video')
                      if (vsndr) {
                          vsndr.replaceTrack(n_trk)
                      }
                  }
                  setIsCamOn(true)
              } catch (err) {
                  console.log(err)
                  alert("cam blocked")
              }
          }
      }
  }

  if (authLoading) {
      return <div className="h-[100dvh] bg-neutral-950 flex items-center justify-center text-neutral-500">Loading App...</div>
  }

  if (am_i_banned) {
      return (
          <div className="h-[100dvh] bg-neutral-950 flex flex-col items-center justify-center text-white p-4 text-center">
              <h1 className="text-4xl font-bold text-red-500 mb-4">ACCESS DENIED</h1>
              <p className="text-neutral-400 max-w-md">Your Google Account has been permanently banned from this platform due to multiple reports of terms of service violations.</p>
          </div>
      )
  }

  if (!user) {
      return (
          <div className="h-[100dvh] bg-neutral-950 flex flex-col items-center justify-center text-white p-4">
              <div className="bg-neutral-900 border border-neutral-800 p-8 rounded-lg max-w-md w-full text-center shadow-2xl">
                  <h1 className="text-2xl font-bold text-blue-500 mb-4">STRANGER_MEET</h1>
                  <h2 className="text-lg font-semibold mb-4 text-neutral-300">Accountability Required</h2>
                  <p className="text-neutral-400 text-sm mb-8 leading-relaxed">
                      To ensure a safe environment, anonymous access is strictly prohibited. You must authenticate with a verified Google account.
                  </p>
                  <button onClick={logInWithGoogle} className="w-full flex items-center justify-center gap-3 px-6 py-3 rounded bg-white hover:bg-neutral-200 text-black font-semibold transition-colors">
                      <img src="https://www.svgrepo.com/show/475656/google-color.svg" className="w-5 h-5" alt="Google" />
                      Sign in with Google
                  </button>
              </div>
          </div>
      )
  }

  return (
    // Replaced h-screen with h-[100dvh] for mobile browsers
    <div className="flex flex-col h-[100dvh] max-h-[100dvh] bg-neutral-950 text-white overflow-hidden">
      
      {/* HEADER: Adjusted text sizes for narrow mobile screens */}
      <header className="p-3 md:p-4 bg-neutral-900 border-b border-neutral-800 flex justify-between items-center shrink-0">
        <h1 className="text-base md:text-xl font-bold text-blue-500 tracking-wide truncate mr-2">STRANGER_MEET</h1>
        
        <div className="flex items-center gap-2 md:gap-4">
          <div className="hidden md:flex items-center gap-2 mr-2">
              <img src={user.photoURL} alt="avatar" className="w-8 h-8 rounded-full border border-neutral-700" />
              <button onClick={logOut} className="text-xs text-neutral-500 hover:text-red-400 transition-colors">Logout</button>
          </div>
          
          {/* report button */}
          {/* {currState === 'connected' && (
              <button onClick={triggerReport} className="hidden md:block px-3 py-1.5 text-xs font-bold rounded bg-red-900/50 text-red-400 border border-red-800 hover:bg-red-800 hover:text-white transition-colors">
                  Report
              </button>
          )} */}

          <button
            onClick={handleNextBtn}
            className={`px-3 md:px-5 py-1.5 text-sm md:text-base font-semibold rounded transition-colors whitespace-nowrap ${
              currState === 'connected' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {currState === 'idle' && 'Start Chat'}
            {currState === 'searching' && 'Skip'}
            {currState === 'connected' && 'Next Stranger'}
          </button>
        </div>
      </header>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 flex flex-col md:flex-row overflow-hidden">
        
        {/* VIDEOS: PiP on Mobile, Side-by-Side on Desktop */}
        <div className="relative w-full h-[40vh] min-h-[250px] md:h-auto md:flex-1 flex md:flex-row gap-2 p-2 bg-neutral-900 shrink-0">
          
          {/* Stranger Video (Takes full box on mobile, 50% on desktop) */}
          <div className="w-full h-full md:w-1/2 bg-black rounded-lg overflow-hidden border border-neutral-800 relative flex items-center justify-center">
            <video ref={otherVid} autoPlay playsInline className="w-full h-full object-cover" />
            <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-0.5 rounded text-xs z-20">Stranger</div>
            {currState === 'searching' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-sm animate-pulse text-neutral-400 z-10 text-center px-4">
                Finding a stranger online...
              </div>
            )}
            {currState === 'idle' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-sm text-neutral-500 z-10 text-center px-4">
                Click "Start Chat" to begin.
              </div>
            )}
          </div>

          {/* Your Video (Floating PiP on mobile, 50% on desktop) */}
          <div className="absolute bottom-4 right-4 w-24 h-36 md:relative md:w-1/2 md:h-full z-30 bg-neutral-800 rounded-lg overflow-hidden border border-neutral-600 md:border-neutral-800 shadow-2xl md:shadow-none flex items-center justify-center">
            
            {/* The Actual Video */}
            <video 
                ref={myVid} 
                autoPlay 
                playsInline 
                muted 
                className={`w-full h-full object-cover transform -scale-x-100 ${!isCamOn ? 'hidden' : ''}`} 
            />

            {/* The Avatar Fallback */}
            {!isCamOn && (
                <div className="absolute inset-0 flex items-center justify-center bg-neutral-800">
                    <svg className="w-12 h-12 md:w-24 md:h-24 text-neutral-600" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                    </svg>
                </div>
            )}

            <div className="absolute bottom-1 left-1 md:bottom-2 md:left-2 bg-black/60 px-1.5 py-0.5 rounded text-[10px] md:text-xs z-10">You</div>
            
            <div className="absolute top-1 right-1 md:top-2 md:right-2 flex flex-col md:flex-row gap-1 md:gap-2 z-10">
                <button onClick={toggleMic} className="bg-neutral-800/80 hover:bg-neutral-700 p-1 md:px-2 md:py-1 rounded text-xs border border-neutral-700 transition-colors" title="Toggle Mic">
                    {isMicOn ? '🎙️' : '🔇'}
                </button>
                <button onClick={toggleCam} className="bg-neutral-800/80 hover:bg-neutral-700 p-1 md:px-2 md:py-1 rounded text-xs border border-neutral-700 transition-colors" title="Toggle Camera">
                    {isCamOn ? '📷' : '🚫'}
                </button>
            </div>
          </div>
        </div>

        {/* CHAT AREA */}
        <div className="flex-1 md:flex-none w-full md:w-80 lg:w-96 flex flex-col border-t md:border-t-0 md:border-l border-neutral-800 bg-neutral-950 overflow-hidden min-h-[200px]">
        <div className="flex-1 p-3 overflow-y-auto space-y-2 text-sm">
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

          <form onSubmit={sendMsg} className="p-2 border-t border-neutral-800 flex gap-2 shrink-0 bg-neutral-950 mb-safe">
            <input
              type="text"
              value={txt}
              onChange={(e) => setTxt(e.target.value)}
              disabled={currState !== 'connected'}
              placeholder={currState === 'connected' ? "Message..." : "Connect first..."}
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