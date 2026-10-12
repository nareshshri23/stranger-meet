import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

let db = null;
let adminAuth = null;
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
        adminAuth = getAuth();
        db = getFirestore();
        console.log("Firebase Admin initialized successfully with Firestore and Auth.");
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

app.get('/health', async (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: Date.now(),
        activeUsers: io.engine.clientsCount,
        standbyQueueLength: await getQueueLength(),
        activeMatches: await getActivePairCount(),
        pendingReconnects: await getPendingReconnectCount()
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
let stateRedis = null;

async function initSharedStateStore() {
    if (!process.env.REDIS_URL) {
        console.log("Running in standalone in-memory signaling mode (REDIS_URL not set).");
        return;
    }

    try {
        const { createClient } = await import('redis');
        const { createAdapter } = await import('@socket.io/redis-adapter');

        const pubClient = createClient({ url: process.env.REDIS_URL });
        const subClient = pubClient.duplicate();

        await Promise.all([pubClient.connect(), subClient.connect()]);
        stateRedis = pubClient;
        io.adapter(createAdapter(pubClient, subClient));
        console.log("Redis Pub/Sub adapter connected successfully for multi-core/cross-instance signaling.");
    } catch (err) {
        console.warn("Failed to initialize Redis adapter, falling back to standalone in-memory mode:", err.message);
    }
}

await initSharedStateStore();

let standbyQueue = [];
let activePairs = {};

// Graceful Reconnect Engine ("Tunnel Drop" Recovery)
// Maps user_uuid -> { partnerId, partner_uuid, roomId, timeout }
const pending_reconnects = new Map();

const queueKey = 'stranger_meet:queue';
const activePairsKey = 'stranger_meet:active_pairs';
const reconnectsKey = 'stranger_meet:reconnects';

async function getQueueSnapshot() {
    if (stateRedis) {
        const ids = await stateRedis.lRange(queueKey, 0, -1);
        return ids.filter(Boolean);
    }
    return standbyQueue.slice();
}

async function getQueueLength() {
    return (await getQueueSnapshot()).length;
}

async function enqueueSocketForMatching(socketId) {
    if (stateRedis) {
        await stateRedis.rPush(queueKey, socketId);
        return;
    }
    standbyQueue.push(socketId);
}

async function removeSocketFromQueue(socketId) {
    if (stateRedis) {
        await stateRedis.lRem(queueKey, 0, socketId);
        return;
    }
    standbyQueue = standbyQueue.filter(id => id !== socketId);
}

async function popNextMatchCandidate() {
    if (stateRedis) {
        // LPOP is atomic, so two workers cannot claim the same queued user.
        return await stateRedis.lPop(queueKey);
    }

    if (standbyQueue.length === 0) return null;
    const candidate = standbyQueue.shift();
    return candidate ?? null;
}

async function getSocketById(socketId) {
    const localSocket = io.sockets.sockets.get(socketId);
    if (localSocket) return localSocket;

    const sockets = await io.fetchSockets();
    return sockets.find(candidate => candidate.id === socketId) || null;
}

async function getActiveSession(socketId) {
    if (stateRedis) {
        const raw = await stateRedis.hGet(activePairsKey, socketId);
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }
    return activePairs[socketId] ?? null;
}

async function setActiveSession(socketId, session) {
    if (stateRedis) {
        await stateRedis.hSet(activePairsKey, socketId, JSON.stringify(session));
        return;
    }
    activePairs[socketId] = session;
}

async function deleteActiveSession(socketId) {
    if (stateRedis) {
        await stateRedis.hDel(activePairsKey, socketId);
        return;
    }
    delete activePairs[socketId];
}

async function getActivePairCount() {
    if (stateRedis) {
        const entries = await stateRedis.hVals(activePairsKey);
        return entries.length / 2;
    }
    return Object.keys(activePairs).length / 2;
}

async function getPendingReconnect(uuid) {
    if (stateRedis) {
        const raw = await stateRedis.hGet(reconnectsKey, uuid);
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }
    return pending_reconnects.get(uuid) ?? null;
}

async function setPendingReconnect(uuid, payload) {
    if (stateRedis) {
        await stateRedis.hSet(reconnectsKey, uuid, JSON.stringify(payload));
        return;
    }
    pending_reconnects.set(uuid, payload);
}

async function deletePendingReconnect(uuid) {
    if (stateRedis) {
        await stateRedis.hDel(reconnectsKey, uuid);
        return;
    }
    pending_reconnects.delete(uuid);
}

async function getPendingReconnectCount() {
    if (stateRedis) {
        return await stateRedis.hLen(reconnectsKey);
    }
    return pending_reconnects.size;
}

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
    const deviceId = socket.handshake.auth.token || socket.handshake.auth.deviceId || null;
    const email = socket.handshake.auth.email || null;
    const firebaseToken = socket.handshake.auth.firebaseToken || null;
    const rawIp = socket.handshake.headers['x-forwarded-for'] 
        ? socket.handshake.headers['x-forwarded-for'].split(',')[0].trim() 
        : socket.handshake.address;
    const ip = isLocalIp(rawIp) ? null : rawIp;

    let user_uuid = deviceId || socket.id;
    let verifiedEmail = email;

    if (firebaseToken) {
        if (!adminAuth) {
            return next(new Error("authentication error: Firebase admin unavailable"));
        }

        try {
            const decoded = await adminAuth.verifyIdToken(firebaseToken);
            user_uuid = decoded.uid;
            verifiedEmail = decoded.email || email || null;
        } catch (err) {
            console.warn("[AUTH] Rejected invalid Firebase token:", err.message);
            return next(new Error("authentication error: invalid Firebase token"));
        }
    }

    if (!deviceId && !firebaseToken) {
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
            const docId = verifiedEmail || user_uuid;
            const directDoc = await bansRef.doc(docId).get();
            if (directDoc.exists && directDoc.data().banExpiry > now) {
                isBanned = true;
            }

            // 2. Check by UUID if email was used as docId
            if (!isBanned && verifiedEmail) {
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
    socket.user_email = verifiedEmail;
    socket.user_auth_type = firebaseToken ? 'firebase' : 'anonymous';
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
    const pending = await getPendingReconnect(socket.user_uuid);
    if (pending) {
        clearTimeout(pending.timeout);
        await deletePendingReconnect(socket.user_uuid);

        const partnerId = pending.partnerId;
        const partnerSocket = io.sockets.sockets.get(partnerId);

        if (partnerSocket && io.sockets.sockets.has(partnerId)) {
            const roomId = pending.roomId;
            socket.join(roomId);

            await setActiveSession(socket.id, { partnerId, roomId, reported: false });
            await setActiveSession(partnerId, { partnerId: socket.id, roomId, reported: false });

            const iceServers = await getTurnServers();
            socket.emit('session_recovered', { roomId, isCaller: true, iceServers });
            io.to(partnerId).emit('session_recovered', { roomId, isCaller: false, iceServers });
            console.log(`[RECOVERY] Gracefully recovered session for UUID: ${socket.user_uuid} with partner ${partnerId}`);
            return;
        }
    }

    socket.on('find_partner', async () => {
        let uid = socket.user_uuid;
        let now_ms = Date.now();

        const pendingReconnect = await getPendingReconnect(uid);
        if (pendingReconnect) {
            clearTimeout(pendingReconnect.timeout);
            await deletePendingReconnect(uid);
        }

        if (!spam_cache[uid]) {
            spam_cache[uid] = { strikes: 0, last_hit: 0 };
        }

        let time_gap = now_ms - spam_cache[uid].last_hit;
        spam_cache[uid].last_hit = now_ms;

        if (time_gap < 300) {
            spam_cache[uid].strikes++;
            if (spam_cache[uid].strikes >= 8) {
                console.log(`[SECURITY] Dropping connection for ${uid}. Reason: Excessive spamming find_partner.`);
                applyBan(socket, 'spam');
                return;
            }
        } else {
            spam_cache[uid].strikes = 0;
        }

        await cleanUpUserSession(socket, false);

        // Remove stale duplicate entries before claiming one candidate.
        await removeSocketFromQueue(socket.id);

        let matchedPeerSocket = null;
        while (!matchedPeerSocket) {
            const candidateId = await popNextMatchCandidate();
            if (!candidateId) break;
            if (candidateId === socket.id) continue;

            const candidateSocket = await getSocketById(candidateId);
            const candidateSession = await getActiveSession(candidateId);
            if (candidateSocket && !candidateSession) {
                matchedPeerSocket = candidateSocket;
                break;
            }
        }

        if (!matchedPeerSocket) {
            await enqueueSocketForMatching(socket.id);
            socket.emit('waiting', { message: 'Looking for a stranger...' });
        } else {
            const peerId = matchedPeerSocket.id;
            const sessionRoomId = `room_${crypto.randomUUID()}`;

            socket.join(sessionRoomId);
            await matchedPeerSocket.join(sessionRoomId);

            await setActiveSession(socket.id, { partnerId: peerId, roomId: sessionRoomId, reported: false });
            await setActiveSession(peerId, { partnerId: socket.id, roomId: sessionRoomId, reported: false });

            const iceServers = await getTurnServers();
            socket.emit('matched', { roomId: sessionRoomId, createOffer: true, iceServers });
            io.to(peerId).emit('matched', { roomId: sessionRoomId, createOffer: false, iceServers });
        }
    });

    socket.on('send_signal', async (data) => {
        if (!data || typeof data !== 'object') return;

        if (!checkSignalRateLimit(socket)) return;

        if (data.sdp && (typeof data.sdp !== 'object' || JSON.stringify(data.sdp).length > 65536)) return;
        if (data.iceCandidate && (typeof data.iceCandidate !== 'object' || JSON.stringify(data.iceCandidate).length > 4096)) return;

        const session = await getActiveSession(socket.id);
        if (!session || !session.partnerId) return;

        const partnerSession = await getActiveSession(session.partnerId);
        if (!partnerSession || partnerSession.partnerId !== socket.id) {
            console.warn(`[SECURITY] Blocked signal injection: Socket ${socket.id} attempted to signal mismatched partner ${session.partnerId}`);
            return;
        }

        io.to(session.partnerId).emit('receive_signal', {
            sdp: data.sdp,
            iceCandidate: data.iceCandidate
        });
    });

    socket.on('snitch_on_partner', async () => {
        const session = await getActiveSession(socket.id);
        if (session && !session.reported) {
            session.reported = true;
            await setActiveSession(socket.id, session);

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

            await cleanUpUserSession(socket, false);
        }
    });

    socket.on('leave_partner', async () => {
        await cleanUpUserSession(socket, false);
    });

    socket.on('disconnect', async () => {
        const ip = socket.user_ip;
        if (ip && ip_connection_counts.has(ip)) {
            const count = ip_connection_counts.get(ip) - 1;
            if (count <= 0) ip_connection_counts.delete(ip);
            else ip_connection_counts.set(ip, count);
        }
        signal_rate_limits.delete(socket.id);

        await cleanUpUserSession(socket, true);
    });
});

/**
 * Handles session cleanup with Graceful Reconnection support
 * @param {Socket} socket 
 * @param {boolean} isUnexpectedDisconnect If true, holds room for 8 seconds to allow Wi-Fi/4G switch
 */
async function cleanUpUserSession(socket, isUnexpectedDisconnect = false) {
    await removeSocketFromQueue(socket.id);
    const session = await getActiveSession(socket.id);

    if (session) {
        const partnerId = session.partnerId;
        const roomId = session.roomId;
        const partnerSocket = await getSocketById(partnerId);

        if (isUnexpectedDisconnect && partnerSocket) {
            io.to(partnerId).emit('partner_reconnecting', {
                message: 'Stranger connection lost. Waiting for reconnect (8s)...'
            });

            const timer = setTimeout(async () => {
                await deletePendingReconnect(socket.user_uuid);
                const reconnectingPartner = await getSocketById(partnerId);
                if (reconnectingPartner) {
                    io.to(partnerId).emit('partner_disconnected', { message: 'Stranger disconnected.' });
                    await reconnectingPartner.leave(roomId);
                    await deleteActiveSession(partnerId);
                }
            }, 8000);

            await setPendingReconnect(socket.user_uuid, {
                partnerId,
                roomId,
                timeout: timer
            });

            await deleteActiveSession(socket.id);
        } else {
            io.to(partnerId).emit('partner_disconnected', { message: 'Stranger disconnected.' });
            if (partnerSocket) partnerSocket.leave(roomId);
            socket.leave(roomId);

            await deleteActiveSession(socket.id);
            await deleteActiveSession(partnerId);
        }
    }
}

// Zombie Connection & Memory Cleanup Sweeper (Runs every 30 seconds)
setInterval(async () => {
    const queueSnapshot = await getQueueSnapshot();
    standbyQueue = queueSnapshot.filter(id => io.sockets.sockets.has(id));

    const activeSocketIds = Object.keys(activePairs);
    for (const socketId of activeSocketIds) {
        const session = activePairs[socketId];
        if (!io.sockets.sockets.has(socketId)) {
            delete activePairs[socketId];
        }
    }

    const now = Date.now();
    for (const uid in spam_cache) {
        if (now - spam_cache[uid].last_hit > 15 * 60 * 1000) {
            delete spam_cache[uid];
        }
    }

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