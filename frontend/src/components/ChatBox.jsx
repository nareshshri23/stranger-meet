import React, { useEffect, useRef } from 'react';
import { Smile } from 'lucide-react';

const COMMON_EMOJIS = ["😀", "😂", "🥰", "😎", "😭", "🥺", "😡", "👍", "👎", "❤️", "🔥", "✨", "🎉", "💯", "🙏", "👋", "👀", "💀", "🤡", "👽"];

export default function ChatBox({
  chatLog,
  strangerTyping,
  matchStatus,
  msgInput,
  showEmojiPicker,
  onTyping,
  onSend,
  onToggleEmoji,
  onEmojiClick
}) {
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatLog, strangerTyping]);

  return (
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
        <div ref={chatEndRef} />
      </div>
      <form onSubmit={onSend} className="p-2 border-t border-neutral-800 flex gap-2 shrink-0 bg-neutral-950 mb-safe relative">
        {showEmojiPicker && (
          <div className="absolute bottom-14 left-2 bg-neutral-900 border border-neutral-700 rounded-lg p-2 grid grid-cols-5 gap-2 z-50 shadow-2xl">
            {COMMON_EMOJIS.map(emoji => (
              <button type="button" key={emoji} onClick={() => onEmojiClick(emoji)} className="text-xl hover:bg-neutral-800 rounded p-1 transition-colors">
                {emoji}
              </button>
            ))}
          </div>
        )}
        <button type="button" onClick={onToggleEmoji} className="text-neutral-400 hover:text-white p-2 shrink-0">
          <Smile className="w-6 h-6" />
        </button>
        <input type="text" value={msgInput} onChange={onTyping} disabled={matchStatus !== 'connected'} className="flex-1 bg-neutral-900 rounded px-3 py-2 text-white focus:outline-none" placeholder="Message..." />
        <button type="submit" disabled={matchStatus !== 'connected'} className="bg-blue-600 px-4 py-2 rounded font-semibold disabled:opacity-50 shrink-0">Send</button>
      </form>
    </div>
  );
}
