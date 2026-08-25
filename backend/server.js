import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

let db = null;
try {
    let serviceAccount = null;
    // For Production (Render / Cloud): Read the JSON string from Environment Variables
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

app.use(cors({ 
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
}));

app.get('/health', (req, res) => {
    res.send('Server is alive and secure');
});

const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true
    }
});

let standbyQueue = [];
let activePairs = {};

// V2.0 COMPLIANCE: UUID Banning instead of IP Banning
const banned_uuids = new Set();
const banned_ips = new Set();

// V2.0 SECURITY: Anti-DDoS Spam Tracker
let spam_cache = {};

// Tracker for user reports (UUID -> Set of reporter UUIDs)
const user_reports = {};

// We now expect the frontend to pass a UUID when connecting
io.use(async (socket, next) => {
    const user_uuid = socket.handshake.auth.token;
    const email = socket.handshake.auth.email || null;
    const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;

    if (!user_uuid) {
        return next(new Error("authentication error: missing UUID"));
    }

    if (db) {
        try {
            const now = Date.now();
            const bansRef = db.collection('bans');
            let isBanned = false;

            // 1. Direct document check (Fastest O(1) read, no composite index needed)
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

            // 3. Check by IP (Single-field query, no composite index required)
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
        if (banned_uuids.has(user_uuid) || banned_ips.has(ip)) {
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
        // User Reports: 1 hour for strike 1
        banDuration = 1 * 60 * 60 * 1000;
    } else {
        // Spammers/Bots: 24 hours for strike 1
        banDuration = 24 * 60 * 60 * 1000;
    }
    
    if (db) {
        try {
            const docId = socket.user_email || socket.user_uuid;
            const banRef = db.collection('bans').doc(docId);
            const doc = await banRef.get();
            
            if (doc.exists) {
                strikeCount = (doc.data().strikeCount || 1) + 1;
                
                if (reason === 'report') {
                    if (strikeCount === 2) banDuration = 8 * 60 * 60 * 1000; // 2nd strike = 8 hours
                    if (strikeCount >= 3) banDuration = 24 * 60 * 60 * 1000; // 3rd strike = 24 hours
                } else {
                    if (strikeCount === 2) banDuration = 5 * 24 * 60 * 60 * 1000; // 2nd strike = 5 days
                    if (strikeCount >= 3) banDuration = 100 * 365 * 24 * 60 * 60 * 1000; // 3rd strike = Permanent
                }
            }

            await banRef.set({
                email: socket.user_email || null,
                uuid: socket.user_uuid,
                ip: socket.user_ip || 'unknown',
                strikeCount: strikeCount,
                reason: reason,
                banExpiry: Date.now() + banDuration,
                updatedAt: new Date().toISOString()
            });

            console.log(`[FIRESTORE] Successfully saved ${reason} ban record for ${docId} (Strike: ${strikeCount}, Duration: ${banDuration / (1000 * 60 * 60)} hours)`);
        } catch (err) {
            console.error("[FIRESTORE ERROR] Failed to write ban:", err);
            // In-memory fallback if Firestore fails
            banned_uuids.add(socket.user_uuid);
            if (socket.user_ip) banned_ips.add(socket.user_ip);
        }
    } else {
        banned_uuids.add(socket.user_uuid);
        if (socket.user_ip) banned_ips.add(socket.user_ip);
    }
    
    socket.emit('you_got_banned', { 
        msg: reason === 'report' 
            ? 'You were reported by multiple users.' 
            : 'Connection dropped due to excessive spamming.' 
    });
    socket.disconnect(true);
}

io.on('connection', (socket) => {
    console.log(`Verified user connected: ${socket.id} (UUID: ${socket.user_uuid})`);

    socket.on('find_partner', () => {
        let uid = socket.user_uuid;
        let now_ms = Date.now();

        // 1. Initialize their tracker if they don't have one
        if (!spam_cache[uid]) {
            spam_cache[uid] = { strikes: 0, last_hit: 0 };
        }

        // 2. Calculate how fast they clicked since their last click
        let time_gap = now_ms - spam_cache[uid].last_hit;
        spam_cache[uid].last_hit = now_ms; // update for next time

        // 3. The Cooldown Check (800ms) - Rate limiting
        if (time_gap < 800) {
            spam_cache[uid].strikes++;

            // If they trigger the cooldown 4 times in a row, they are botting
            if (spam_cache[uid].strikes >= 4) {
                console.log(`[SECURITY] Dropping connection for ${uid}. Reason: Spamming.`);
                applyBan(socket, 'spam');
                return;
            }

            // Ignore the spam click, but don't kick them yet
            return;
        } else {
            // They waited long enough, reset their strikes
            spam_cache[uid].strikes = 0;
        }

        // 4. If they passed the rate limit, proceed with normal matchmaking
        cleanUpUserSession(socket);

        if (standbyQueue.length === 0) {
            standbyQueue.push(socket.id);
            socket.emit('waiting', { message: 'Looking for a stranger...' });
        } else {
            const peerId = standbyQueue.shift();
            if (peerId === socket.id) {
                standbyQueue.push(socket.id);
                return;
            }

            const sessionRoomId = `room_${peerId}_${socket.id}`;
            socket.join(sessionRoomId);

            const peerSocket = io.sockets.sockets.get(peerId);
            if (peerSocket) peerSocket.join(sessionRoomId);

            activePairs[socket.id] = { partnerId: peerId, roomId: sessionRoomId };
            activePairs[peerId] = { partnerId: socket.id, roomId: sessionRoomId };

            const turnConfig = {
                username: process.env.TURN_USERNAME || process.env.VITE_TURN_USERNAME || 'openrelayproject',
                credential: process.env.TURN_PASSWORD || process.env.VITE_TURN_PASSWORD || 'openrelayproject'
            };

            const customTurnUrl = process.env.TURN_URL || process.env.VITE_TURN_URL;
            if (customTurnUrl) {
                turnConfig.urls = [customTurnUrl];
            }

            socket.emit('matched', { roomId: sessionRoomId, createOffer: true, turnConfig });
            io.to(peerId).emit('matched', { roomId: sessionRoomId, createOffer: false, turnConfig });
        }
    });

    socket.on('send_signal', (data) => {
        const session = activePairs[socket.id];
        if (session && session.partnerId) {
            io.to(session.partnerId).emit('receive_signal', {
                sdp: data.sdp,
                iceCandidate: data.iceCandidate
            });
        }
    });

    // V2.0 SAFETY FEATURE: The Snitch Button (UUID-based banning)
    socket.on('snitch_on_partner', () => {
        const session = activePairs[socket.id];
        if (session) {
            const badGuyId = session.partnerId;
            const badGuySocket = io.sockets.sockets.get(badGuyId);

            if (badGuySocket) {
                const badGuyUUID = badGuySocket.user_uuid;
                const reporterUUID = socket.user_uuid;

                // Initialize report set if it doesn't exist
                if (!user_reports[badGuyUUID]) {
                    user_reports[badGuyUUID] = new Set();
                }

                // Add this reporter
                user_reports[badGuyUUID].add(reporterUUID);

                // Check if they hit the 3-strike threshold
                if (user_reports[badGuyUUID].size >= 3) {
                    console.log(`[SECURITY] BANNED UUID: ${badGuyUUID} and IP: ${badGuySocket.user_ip} (3 strikes)`);
                    
                    applyBan(badGuySocket, 'report');

                    // Clean up reports to save memory
                    delete user_reports[badGuyUUID];
                } else {
                    console.log(`[SECURITY] REPORTED UUID: ${badGuyUUID} (Strike ${user_reports[badGuyUUID].size}/3)`);
                }
            }

            // Clean up the room so the reporter can move on
            cleanUpUserSession(socket);
        }
    });

    socket.on('disconnect', () => {
        cleanUpUserSession(socket);
    });
});

function cleanUpUserSession(socket) {
    standbyQueue = standbyQueue.filter(id => id !== socket.id);
    const session = activePairs[socket.id];

    if (session) {
        const partnerId = session.partnerId;
        const roomId = session.roomId;

        io.to(partnerId).emit('partner_disconnected', { message: 'Stranger disconnected.' });

        const partnerSocket = io.sockets.sockets.get(partnerId);
        if (partnerSocket) partnerSocket.leave(roomId);

        delete activePairs[socket.id];
        delete activePairs[partnerId];
    }
}

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Signaling server listening on port ${PORT}`);
});