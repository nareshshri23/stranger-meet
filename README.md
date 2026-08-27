# 🌐 APARICHAT — Free Random Video & Text Chat

<p align="center">
  <a href="https://aparichat.app" target="_blank">
    <img src="frontend/public/logo.png" alt="Aparichat Logo" width="90" height="90" />
  </a>
</p>

<p align="center">
  <b>A fast, free, and secure peer-to-peer random video and text chat web application to meet new people worldwide.</b>
</p>

<p align="center">
  <a href="https://aparichat.app"><img src="https://img.shields.io/badge/Live_Site-aparichat.app-2563eb?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Live Site" /></a>
  <a href="https://webrtc.org"><img src="https://img.shields.io/badge/WebRTC-P2P_Encrypted-FF6B6B?style=for-the-badge&logo=webrtc&logoColor=white" alt="WebRTC" /></a>
  <a href="https://react.dev"><img src="https://img.shields.io/badge/Frontend-React_18-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Backend-Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="MIT License" /></a>
</p>

---

## 🔗 Live Application

🌐 **Website**: [https://aparichat.app](https://aparichat.app)

---

## ✨ Features

- 🎥 **Real-Time P2P Video & Audio**: Ultra-low latency video streaming powered by WebRTC with pre-allocated transceivers.
- 📱 **Cross-Network Compatibility**: Multi-transport TURN relays (`UDP`, `TCP`, `TLS`) allowing seamless connection between mobile cellular data (4G/5G) and home Wi-Fi.
- 💬 **Encrypted P2P Text Chat**: Direct client-to-client messaging over SCTP DataChannels with DOMPurify sanitization.
- ⚡ **Smart Matchmaking**: Sub-300ms pairing queue with instant zero-delay tab close cleanup and anti-spam protection.
- 🔒 **Privacy & Safety**: Safe hardware camera/mic controls, 18+ age verification, and community report/moderation tools.
- 🎨 **Modern Responsive UI**: Clean dark mode interface built with Tailwind CSS, Lucide icons, and real-time connection telemetry.

---

## 🛠️ Tech Stack

- **Frontend**: React 18, Vite, Tailwind CSS, Lucide React, Firebase Authentication, DOMPurify
- **Backend**: Node.js, Express, Socket.io
- **Media & Protocol**: WebRTC (RTCPeerConnection, RTCDataChannel), STUN/TURN Relays
- **Hosting**: Vercel (Frontend) & Render (Backend Signaling Service)

---

## 📂 Project Structure

```
aparichat/
├── backend/
│   ├── package.json
│   └── server.js               # Signaling server, matchmaking queue & moderation logic
│
├── frontend/
│   ├── public/                 # Favicons, PWA manifest, SEO schemas & sitemap
│   ├── src/
│   │   ├── components/         # React UI components (Video, Chat, Modals, Toasts)
│   │   ├── utils/              # Text sanitization & P2P rate limiters
│   │   ├── App.jsx             # WebRTC state machine & signaling coordinator
│   │   └── firebase.js         # Firebase Auth configuration
│   ├── index.html              # Open Graph, SEO tags & JSON-LD schemas
│   └── vite.config.js
│
└── README.md
```

---

## 🚀 Getting Started Locally

### 1. Prerequisites
- **Node.js** (v18.0.0 or higher)
- **npm** or **yarn**

### 2. Clone the Repository
```bash
git clone https://github.com/nareshshri23/stranger-meet.git
cd stranger-meet
```

### 3. Backend Setup
```bash
cd backend
npm install
npm start
```
> The signaling server runs on `http://localhost:5000`.

### 4. Frontend Setup
In a new terminal window:
```bash
cd frontend
npm install
npm run dev
```
> The frontend runs on `http://localhost:5173`.

---

## 🔐 Environment Variables

### Backend (`backend/.env`)
```env
PORT=5000
FRONTEND_URL=http://localhost:5173,https://aparichat.app
ALLOWED_ORIGINS=http://localhost:5173,https://aparichat.app
```

### Frontend (`frontend/.env`)
```env
VITE_SERVER_URL=http://localhost:5000
VITE_FIREBASE_API_KEY=your_firebase_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
```

