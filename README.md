# STRANGER_MEET - Anonymous Video Chat Platform

A real-time video chat application that connects random strangers for peer-to-peer video and text conversations.

## 🚀 Features

- **P2P Video & Audio**: Direct peer-to-peer video and audio streaming using WebRTC
- **Text Chat**: Real-time messaging via WebRTC data channels
- **Random Matching**: Connect with random strangers instantly
- **Camera & Mic Control**: Toggle audio and video on/off during calls
- **Report System**: Report inappropriate behavior (IP-based banning)
- **Age Verification**: 18+ age gate with localStorage persistence
- **Responsive Design**: Mobile-friendly UI with Tailwind CSS

## 🛠️ Tech Stack

### Backend
- **Node.js** - JavaScript runtime
- **Express** - Web framework
- **Socket.io** - Real-time WebSocket communication
- **CORS** - Cross-origin resource sharing

### Frontend
- **React** - UI framework
- **Vite** - Fast build tool
- **Socket.io Client** - Client-side WebSocket
- **Tailwind CSS** - Utility-first CSS framework
- **WebRTC** - Peer-to-peer media streaming

## 📋 Prerequisites

- Node.js (v14 or higher)
- npm or yarn package manager

## 📦 Installation

1. **Clone the repository**
```bash
cd chat-webapp
```

2. **Install backend dependencies**
```bash
cd backend
npm install
```

3. **Install frontend dependencies**
```bash
cd ../frontend
npm install
```

## ▶️ Running the Application

### Start Backend Server
```bash
cd backend
npm start
```
Server runs on `http://localhost:5000`

### Start Frontend Development Server
```bash
cd frontend
npm run dev
```
Frontend runs on `http://localhost:5173`

### Build for Production
```bash
cd frontend
npm run build
```

## 📝 Usage

1. Open the app in your browser
2. Accept the 18+ age agreement (stored in localStorage)
3. Allow camera and microphone permissions
4. Click "Start Chatting" to find a random stranger
5. Use text chat via the data channel on the right
6. Toggle mic/camera buttons to control media
7. Click "Report" to ban inappropriate users
8. Click "Next Stranger" to disconnect and find someone new

## 🔧 Project Structure

```
chat-webapp/
├── backend/
│   ├── package.json
│   ├── server.js          # Main server & signaling logic
│   └── node_modules/
│
└── frontend/
    ├── src/
    │   ├── App.jsx        # Main React component
    │   ├── index.css      # Global styles
    │   ├── main.jsx       # React entry point
    │   └── assets/        # Images & icons
    ├── index.html         # HTML template
    ├── package.json
    ├── vite.config.js     # Vite configuration
    ├── tailwind.config.js # Tailwind configuration
    └── node_modules/
```

## ⚙️ Configuration

### Backend Server Port
Edit `backend/server.js`:
```javascript
const PORT = process.env.PORT || 5000;
```

### Frontend API URL
Edit `frontend/src/App.jsx`:
```javascript
const SOKET_URL = 'http://localhost:5000'
```

## 🔒 Security Notes

⚠️ **Important**: This is a development version. Before deploying to production:

- [ ] Enable HTTPS/WSS (use Let's Encrypt)
- [ ] Restrict CORS to specific domains
- [ ] Add rate limiting to prevent abuse
- [ ] Implement proper user authentication
- [ ] Add server-side input validation
- [ ] Replace IP-based banning with user ID system
- [ ] Add XSS protection for messages
- [ ] Implement content moderation
- [ ] Add monitoring and logging

See [SECURITY.md](./SECURITY.md) for detailed security recommendations.

## 🐛 Known Issues

- Age verification relies on localStorage (easily bypassed)
- No persistent data storage
- Single server instance (no clustering)
- IP-based banning affected by VPNs/shared networks
- No user authentication system

## 📊 Performance & Capacity

- **Concurrent Users**: 50-300 (single server, development)
- **Memory Usage**: ~2-5MB per active connection
- **Recommended Max**: 100-500 users with proper infrastructure

## 🚀 Future Improvements

- [ ] Database integration (MongoDB/PostgreSQL)
- [ ] User authentication & profiles
- [ ] Video recording
- [ ] Screen sharing
- [ ] Text message history
- [ ] Friend/block list
- [ ] Multiple chat rooms
- [ ] Better content moderation
- [ ] Horizontal scaling with Redis
- [ ] Advanced analytics

## 📄 License

This project is open source and available under the MIT License.

## 👤 Support

For issues, bugs, or feature requests, please open an issue on GitHub.

---

**Last Updated**: June 2, 2026
