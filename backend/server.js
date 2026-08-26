import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

let db = null;
try {
    let serviceAccount = null;
    // For Production (Render / Cloud): Read JSON string from Environment Variables
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        serviceAccount = typeof process.env.FIREBASE_SERVICE_ACCOUNT === 'string'
            ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
            : process.env.FIREBASE_SERVICE_ACCOUNT;
    } else {
        // For Local Development: Resolve path relative to server.js or current working directory
        const localKeyPath = path.resolve(__dirname, 'serviceAccountKey.json');
        const cwdKeyPath = path.resolve(process.cwd(), 'serviceAccountKey.json');
        
        if (fs.existsSync(localKeyPath)) {
            serviceAccount = JSON.parse(fs.readFileSync(localKeyPath, 'utf8'));
        } else if (fs.existsSync(cwdKeyPath)) {
            serviceAccount = JSON.parse(fs.readFileSync(cwdKeyPath, 'utf8'));
        }
    }
    
    if (serviceAccount) {
        initializeApp({
            credential: cert(serviceAccount)
        });
        db = getFirestore();
        console.log("Firebase Admin initialized successfully with Firestore.");
    } else {
        console.warn("No Firebase service account credentials found. Running with in-memory fallback.");
    }
} catch (err) {
    console.error("Firebase Admin setup skipped or failed. Using fallback.", err.message);
}

// Configurable allowed CORS origins
const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : [
        "http://localhost:5173", 
        "http://127.0.0.1:5173",
        "https://aparichat.app",
        "https://www.aparichat.app",
        "https://stranger-meet-two.vercel.app", 
        "https://aparichat.vercel.app"
      ];

// Strict Origin Validation Function (Rejects wildcard '*' and unknown domains)
const isAllowedOrigin = (origin) => {
    if (!origin) return true; // Allow non-browser direct server-to-server healthchecks
    return allowedOrigins.includes(origin);
};

// Global API & Server Security Headers Middleware
app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    next();
});

// Strict Express CORS Middleware
app.use(cors({ 
    origin: (origin, callback) => {
        if (!origin || isAllowedOrigin(origin)) {
            callback(null, true);
        } else {
            console.warn(`[SECURITY] Blocked CORS request from unauthorized origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ["GET", "POST"],
    credentials: true
}));

app.use(express.json({ limit: '10kb' }));

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: Date.now(),
        activeUsers: io.engine.clientsCount,
        standbyQueueLength: standbyQueue.length,
        activeMatches: Object.keys(activePairs).length / 2,
        pendingReconnects: pending_reconnects.size
    });
});

/**
 * TURN & STUN Configuration Generator
 * Supports Metered.ca dynamic REST API, Coturn Ephemeral HMAC tokens, and multi-protocol fallbacks (UDP, TCP, TLS)
 */
async function getTurnServers() {
    // 1. Metered.ca dynamic API if configured
    if (process.env.METERED_API_KEY && process.env.METERED_APP_NAME) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            const res = await fetch(`https://${process.env.METERED_APP_NAME}.metered.ca/api/v1/turn/credentials?apiKey=${process.env.METERED_API_KEY}`, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (res.ok) {
                const dynamicIceServers = await res.json();
                if (Array.isArray(dynamicIceServers) && dynamicIceServers.length > 0) {
                    return dynamicIceServers;
                }
            }
        } catch (err) {
            console.warn("[TURN] Metered API fetch failed, falling back to static config:", err.message);
        }
    }

    // 2. Coturn Ephemeral HMAC Credentials if configured (TTL 12 hours)
    if (process.env.COTURN_SECRET) {
        const ttl = 12 * 3600;
        const expiry = Math.floor(Date.now() / 1000) + ttl;
        const username = `${expiry}:aparichat_user`;
        const hmac = crypto.createHmac('sha1', process.env.COTURN_SECRET);
        hmac.update(username);
        const credential = hmac.digest('base64');
        const coturnUrls = process.env.COTURN_URLS 
            ? process.env.COTURN_URLS.split(',').map(u => u.trim())
            : [
                'turn:turn.aparichat.app:3478?transport=udp',
                'turn:turn.aparichat.app:3478?transport=tcp',
                'turns:turn.aparichat.app:443?transport=tcp',
                'turns:turn.aparichat.app:5349?transport=tcp'
            ];
        return [
            { urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
            { urls: coturnUrls, username, credential }
        ];
    }

    // 3. Robust OpenRelay / Environment Fallback (STUN + UDP + TCP + TURNS TLS)
    const turnUsername = process.env.TURN_USERNAME || process.env.VITE_TURN_USERNAME || 'openrelayproject';
    const turnCredential = process.env.TURN_PASSWORD || process.env.VITE_TURN_PASSWORD || 'openrelayproject';
    const customTurnUrls = (process.env.TURN_URL || process.env.VITE_TURN_URL) 
        ? [process.env.TURN_URL || process.env.VITE_TURN_URL]
        : [
            'turn:openrelay.metered.ca:80',
            'turn:openrelay.metered.ca:443?transport=tcp',
            'turns:openrelay.metered.ca:443?transport=tcp',
            'turns:openrelay.metered.ca:5349?transport=tcp'
        ];

    return [
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
            urls: customTurnUrls,
            username: turnUsername,
            credential: turnCredential
        }
    ];
}

// REST API endpoint to deliver ephemeral TURN credentials securely
app.get('/api/turn-credentials', async (req, res) => {
    try {
        const iceServers = await getTurnServers();
        res.json({ iceServers });
    } catch (err) {
        res.status(500).json({ error: "Failed to generate TURN credentials" });
    }
});

const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: (origin, callback) => {
            if (!origin || isAllowedOrigin(origin)) {
                callback(null, true);
            } else {
                callback(new Error('Origin unauthorized by CORS'));
            }
        },
        methods: ["GET", "POST"],
        credentials: true
    },
    // Handshake Gate: Drop unauthorized cross-origin WebSocket upgrades before allocating resources
    allowRequest: (req, callback) => {
        const origin = req.headers.origin;
        if (!origin || isAllowedOrigin(origin)) {
            callback(null, true);
        } else {
            console.warn(`[SECURITY] Rejected unauthorized Socket.io handshake from origin: ${origin}`);
            callback(403, false);
        }
    },
    pingTimeout: 10000,
    pingInterval: 5000,
});

// Cross-Instance Signaling Adapter for Multi-Core / Multi-Server Scaling (Render & PM2)
if (process.env.REDIS_URL) {
    try {
        const { createClient } = await import('redis');
        const { createAdapter } = await import('@socket.io/redis-adapter');
        
        const pubClient = createClient({ url: process.env.REDIS_URL });
        const subClient = pubClient.duplicate();

        await Promise.all([pubClient.connect(), subClient.connect()]);
        io.adapter(createAdapter(pubClient, subClient));
        console.log("Redis Pub/Sub adapter connected successfully for multi-core/cross-instance signaling.");
    } catch (err) {
        console.warn("Failed to initialize Redis adapter, falling back to standalone in-memory mode:", err.message);
    }
} else {
    console.log("Running in standalone in-memory signaling mode (REDIS_URL not set).");
}

let standbyQueue = [];
let activePairs = {};

// Graceful Reconnect Engine ("Tunnel Drop" Recovery)
// Maps user_uuid -> { partnerId, partner_uuid, roomId, timeout }
const pending_reconnects = new Map();

// In-Memory Banning Fallbacks
const banned_uuids = new Set();
const banned_ips = new Set();

// Anti-DDoS Spam Trackers
let spam_cache = {};
const signal_rate_limits = new Map(); // socket.id -> { count, resetTime }
const ip_connection_counts = new Map(); // ip -> count

// Tracker for user reports (UUID -> Set of reporter UUIDs)
const user_reports = {};

// Signaling Rate Limiter (Token bucket per socket: Max 35 signals / 5s)
function checkSignalRateLimit(socket) {
    const now = Date.now();
    let record = signal_rate_limits.get(socket.id);
    if (!record || now > record.resetTime) {
        record = { count: 1, resetTime: now + 5000 };
        signal_rate_limits.set(socket.id, record);
        return true;
    }
    record.count++;
    if (record.count > 35) {
        console.warn(`[SECURITY] Signal rate limit exceeded for socket ${socket.id} (UUID: ${socket.user_uuid}). Signals: ${record.count}`);
        return false;
    }
    return true;
}

const isLocalIp = (testIp) => {
    if (!testIp) return true;
    return testIp === '127.0.0.1' || 
           testIp === '::1' || 
           testIp === '::ffff:127.0.0.1' || 
           testIp === 'localhost' || 
           testIp === 'unknown' ||
           testIp.startsWith('127.') ||
           testIp.startsWith('192.168.') ||
           testIp.startsWith('10.');
};

// Authenticate and rate limit socket connections
io.use(async (socket, next) => {
    const user_uuid = socket.handshake.auth.token;
    const email = socket.handshake.auth.email || null;
    const rawIp = socket.handshake.headers['x-forwarded-for'] 
        ? socket.handshake.headers['x-forwarded-for'].split(',')[0].trim() 
        : socket.handshake.address;
    const ip = isLocalIp(rawIp) ? null : rawIp;

    if (!user_uuid) {
        return next(new Error("authentication error: missing UUID"));
    }

    // Anti-Bot Farm: Max 25 concurrent sockets per IP (ignored for local development)
    if (ip) {
        const currentIpCount = (ip_connection_counts.get(ip) || 0) + 1;
        if (currentIpCount > 25) {
            return next(new Error("rate limit: too many connections from this IP"));
        }
        ip_connection_counts.set(ip, currentIpCount);
    }

    if (db) {
        try {
            const now = Date.now();
            const bansRef = db.collection('bans');
            let isBanned = false;

            // 1. Direct document check (Fastest O(1) read, zero index required)
            const docId = email || user_uuid;
            const directDoc = await bansRef.doc(docId).get();
            if (directDoc.exists && directDoc.data().banExpiry > now) {
                isBanned = true;
            }

            // 2. Check by UUID if email was used as docId
            if (!isBanned && email) {
                const uuidSnap = await bansRef.where('uuid', '==', user_uuid).get();
                if (!uuidSnap.empty && uuidSnap.docs.some(doc => doc.data().banExpiry > now)) {
                    isBanned = true;
                }
            }

            // 3. Check by IP (Only for public internet IPs, never localhost)
            if (!isBanned && ip) {
                const ipSnap = await bansRef.where('ip', '==', ip).get();
                if (!ipSnap.empty && ipSnap.docs.some(doc => doc.data().banExpiry > now)) {
                    isBanned = true;
                }
            }

            if (isBanned) {
                return next(new Error("access denied: UUID or IP banned"));
            }
        } catch (err) {
            console.error("Firestore auth error:", err);
        }
    } else {
        if (banned_uuids.has(user_uuid) || (ip && banned_ips.has(ip))) {
            return next(new Error("access denied: UUID or IP banned"));
        }
    }

    socket.user_uuid = user_uuid;
    socket.user_ip = ip;
    socket.user_email = email;
    next();
});

async function applyBan(socket, reason = 'spam') {
    let strikeCount = 1;
    let banDuration;

    if (reason === 'report') {
        banDuration = 1 * 60 * 60 * 1000; // 1 hour for strike 1
    } else {
        banDuration = 24 * 60 * 60 * 1000; // 24 hours for strike 1
    }
    
    if (db) {
        try {
            const docId = socket.user_email || socket.user_uuid;
            const banRef = db.collection('bans').doc(docId);
            const doc = await banRef.get();
            
            if (doc.exists) {
                strikeCount = (doc.data().strikeCount || 1) + 1;
                
                if (reason === 'report') {
                    if (strikeCount === 2) banDuration = 8 * 60 * 60 * 1000;
                    if (strikeCount >= 3) banDuration = 24 * 60 * 60 * 1000;
                } else {
                    if (strikeCount === 2) banDuration = 5 * 24 * 60 * 60 * 1000;
                    if (strikeCount >= 3) banDuration = 100 * 365 * 24 * 60 * 60 * 1000;
                }
            }

            await banRef.set({
                email: socket.user_email || null,
                uuid: socket.user_uuid,
                ip: socket.user_ip || null,
                strikeCount: strikeCount,
                reason: reason,
                banExpiry: Date.now() + banDuration,
                updatedAt: new Date().toISOString()
            });

            console.log(`[FIRESTORE] Saved ${reason} ban record for ${docId} (Strike: ${strikeCount}, Duration: ${banDuration / (1000 * 60 * 60)}h)`);
        } catch (err) {
            console.error("[FIRESTORE ERROR] Failed to write ban:", err);
            banned_uuids.add(socket.user_uuid);
            if (socket.user_ip && !isLocalIp(socket.user_ip)) banned_ips.add(socket.user_ip);
        }
    } else {
        banned_uuids.add(socket.user_uuid);
        if (socket.user_ip && !isLocalIp(socket.user_ip)) banned_ips.add(socket.user_ip);
    }
    
    socket.emit('you_got_banned', { 
        msg: reason === 'report' 
            ? 'You were reported by multiple users.' 
            : 'Connection dropped due to excessive spamming.' 
    });
    cleanUpUserSession(socket, false);
    socket.disconnect(true);
}

io.on('connection', async (socket) => {
    console.log(`Verified user connected: ${socket.id} (UUID: ${socket.user_uuid})`);

    // Edge Case 2: Check if this user was in a "Tunnel Drop" reconnect window
    if (pending_reconnects.has(socket.user_uuid)) {
        const pending = pending_reconnects.get(socket.user_uuid);
        clearTimeout(pending.timeout);
        pending_reconnects.delete(socket.user_uuid);

        const partnerId = pending.partnerId;
        const partnerSocket = io.sockets.sockets.get(partnerId);

        if (partnerSocket && io.sockets.sockets.has(partnerId)) {
            const roomId = pending.roomId;
            socket.join(roomId);

            // Re-bind bidirectional pairing
            activePairs[socket.id] = { partnerId: partnerId, roomId: roomId, reported: false };
            activePairs[partnerId] = { partnerId: socket.id, roomId: roomId, reported: false };

            const iceServers = await getTurnServers();

            // Notify both clients to perform smooth WebRTC ICE restart
            socket.emit('session_recovered', { roomId, isCaller: true, iceServers });
            io.to(partnerId).emit('session_recovered', { roomId, isCaller: false, iceServers });
            console.log(`[RECOVERY] Gracefully recovered session for UUID: ${socket.user_uuid} with partner ${partnerId}`);
            return;
        }
    }

    socket.on('find_partner', async () => {
        let uid = socket.user_uuid;
        let now_ms = Date.now();

        // Clear any lingering reconnect hold for this user
        if (pending_reconnects.has(uid)) {
            const pending = pending_reconnects.get(uid);
            clearTimeout(pending.timeout);
            pending_reconnects.delete(uid);
        }

        // 1. Initialize tracker
        if (!spam_cache[uid]) {
            spam_cache[uid] = { strikes: 0, last_hit: 0 };
        }

        // 2. Cooldown check (800ms)
        let time_gap = now_ms - spam_cache[uid].last_hit;
        spam_cache[uid].last_hit = now_ms;

        if (time_gap < 800) {
            spam_cache[uid].strikes++;
            if (spam_cache[uid].strikes >= 4) {
                console.log(`[SECURITY] Dropping connection for ${uid}. Reason: Spamming find_partner.`);
                applyBan(socket, 'spam');
                return;
            }
            return;
        } else {
            spam_cache[uid].strikes = 0;
        }

        // 3. Matchmaking
        cleanUpUserSession(socket, false);

        if (standbyQueue.length === 0) {
            standbyQueue.push(socket.id);
            socket.emit('waiting', { message: 'Looking for a stranger...' });
        } else {
            const peerId = standbyQueue.shift();
            if (peerId === socket.id) {
                standbyQueue.push(socket.id);
                return;
            }

            const peerSocket = io.sockets.sockets.get(peerId);
            if (!peerSocket) {
                // Peer disconnected while in queue; place current user in queue
                standbyQueue.push(socket.id);
                socket.emit('waiting', { message: 'Looking for a stranger...' });
                return;
            }

            // Edge Case 1: Unguessable 128-bit Cryptographic Room ID & Strict 1-on-1 Locking
            const sessionRoomId = `room_${crypto.randomUUID()}`;
            
            // Strictly guarantee max 2 members per room
            const roomOccupancy = io.sockets.adapter.rooms.get(sessionRoomId)?.size || 0;
            if (roomOccupancy >= 2) {
                console.error(`[SECURITY] Attempted third-party intrusion into room ${sessionRoomId}.`);
                return;
            }

            socket.join(sessionRoomId);
            peerSocket.join(sessionRoomId);

            activePairs[socket.id] = { partnerId: peerId, roomId: sessionRoomId, reported: false };
            activePairs[peerId] = { partnerId: socket.id, roomId: sessionRoomId, reported: false };

            const iceServers = await getTurnServers();

            socket.emit('matched', { roomId: sessionRoomId, createOffer: true, iceServers });
            io.to(peerId).emit('matched', { roomId: sessionRoomId, createOffer: false, iceServers });
        }
    });

    socket.on('send_signal', (data) => {
        if (!data || typeof data !== 'object') return;

        // Rate limiting check
        if (!checkSignalRateLimit(socket)) return;

        // Payload size safety checks (prevent memory flooding attacks)
        if (data.sdp && (typeof data.sdp !== 'object' || JSON.stringify(data.sdp).length > 65536)) return;
        if (data.iceCandidate && (typeof data.iceCandidate !== 'object' || JSON.stringify(data.iceCandidate).length > 4096)) return;

        // Edge Case 1: Strict Bi-directional Pairing Integrity Check
        const session = activePairs[socket.id];
        if (!session || !session.partnerId) return;

        const partnerSession = activePairs[session.partnerId];
        if (!partnerSession || partnerSession.partnerId !== socket.id) {
            console.warn(`[SECURITY] Blocked signal injection: Socket ${socket.id} attempted to signal mismatched partner ${session.partnerId}`);
            return;
        }

        io.to(session.partnerId).emit('receive_signal', {
            sdp: data.sdp,
            iceCandidate: data.iceCandidate
        });
    });

    // Safety: The Snitch Button with single-use per session
    socket.on('snitch_on_partner', () => {
        const session = activePairs[socket.id];
        if (session && !session.reported) {
            session.reported = true;
            const badGuyId = session.partnerId;
            const badGuySocket = io.sockets.sockets.get(badGuyId);

            if (badGuySocket) {
                const badGuyUUID = badGuySocket.user_uuid;
                const reporterUUID = socket.user_uuid;

                if (!user_reports[badGuyUUID]) {
                    user_reports[badGuyUUID] = new Set();
                }

                user_reports[badGuyUUID].add(reporterUUID);

                if (user_reports[badGuyUUID].size >= 3) {
                    console.log(`[SECURITY] BANNED UUID: ${badGuyUUID} and IP: ${badGuySocket.user_ip} (3 strikes)`);
                    applyBan(badGuySocket, 'report');
                    delete user_reports[badGuyUUID];
                } else {
                    console.log(`[SECURITY] REPORTED UUID: ${badGuyUUID} (Strike ${user_reports[badGuyUUID].size}/3)`);
                }
            }

            cleanUpUserSession(socket, false);
        }
    });

    // Intentional leave (Next button, tab close, logout) -> immediate zero-lag disconnect
    socket.on('leave_partner', () => {
        cleanUpUserSession(socket, false);
    });

    socket.on('disconnect', () => {
        const ip = socket.user_ip;
        if (ip && ip_connection_counts.has(ip)) {
            const count = ip_connection_counts.get(ip) - 1;
            if (count <= 0) ip_connection_counts.delete(ip);
            else ip_connection_counts.set(ip, count);
        }
        signal_rate_limits.delete(socket.id);
        
        // Treat unexpected socket drop with graceful reconnect grace period
        cleanUpUserSession(socket, true);
    });
});

/**
 * Handles session cleanup with Graceful Reconnection support
 * @param {Socket} socket 
 * @param {boolean} isUnexpectedDisconnect If true, holds room for 8 seconds to allow Wi-Fi/4G switch
 */
function cleanUpUserSession(socket, isUnexpectedDisconnect = false) {
    standbyQueue = standbyQueue.filter(id => id !== socket.id);
    const session = activePairs[socket.id];

    if (session) {
        const partnerId = session.partnerId;
        const roomId = session.roomId;
        const partnerSocket = io.sockets.sockets.get(partnerId);

        if (isUnexpectedDisconnect && partnerSocket && io.sockets.sockets.has(partnerId)) {
            // Edge Case 2: Start 8-Second Grace Period for Network Transitions (Elevator / Wi-Fi to 4G)
            io.to(partnerId).emit('partner_reconnecting', { 
                message: 'Stranger connection lost. Waiting for reconnect (8s)...' 
            });

            const timer = setTimeout(() => {
                pending_reconnects.delete(socket.user_uuid);
                if (io.sockets.sockets.has(partnerId)) {
                    io.to(partnerId).emit('partner_disconnected', { message: 'Stranger disconnected.' });
                    const pSock = io.sockets.sockets.get(partnerId);
                    if (pSock) pSock.leave(roomId);
                    delete activePairs[partnerId];
                }
            }, 8000);

            pending_reconnects.set(socket.user_uuid, {
                partnerId: partnerId,
                roomId: roomId,
                timeout: timer
            });

            delete activePairs[socket.id];
        } else {
            // Clean/intentional disconnection or partner already gone
            io.to(partnerId).emit('partner_disconnected', { message: 'Stranger disconnected.' });
            if (partnerSocket) partnerSocket.leave(roomId);
            socket.leave(roomId);

            delete activePairs[socket.id];
            delete activePairs[partnerId];
        }
    }
}

// Zombie Connection & Memory Cleanup Sweeper (Runs every 30 seconds)
setInterval(() => {
    // 1. Purge standbyQueue from dead sockets
    standbyQueue = standbyQueue.filter(id => io.sockets.sockets.has(id));

    // 2. Clean activePairs from orphaned sessions (ignoring active reconnect holds)
    const activeSocketIds = Object.keys(activePairs);
    for (const socketId of activeSocketIds) {
        const session = activePairs[socketId];
        if (!io.sockets.sockets.has(socketId)) {
            delete activePairs[socketId];
        }
    }

    // 3. Prune old spam_cache entries older than 15 minutes to prevent memory leak
    const now = Date.now();
    for (const uid in spam_cache) {
        if (now - spam_cache[uid].last_hit > 15 * 60 * 1000) {
            delete spam_cache[uid];
        }
    }

    // 4. Prune signal rate limit trackers
    for (const [id, record] of signal_rate_limits.entries()) {
        if (now > record.resetTime) {
            signal_rate_limits.delete(id);
        }
    }
}, 30000);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Signaling server listening on port ${PORT}`);
});