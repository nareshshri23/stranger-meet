import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();

// SECURITY PATCH: Only allow your specific frontend to talk to this backend
const SAFE_ORIGIN = 'http://localhost:5173'; // Change this to your Vercel URL later

app.use(cors({ origin: SAFE_ORIGIN }));

app.get('/health', (req, res) => {
    res.send('Server is alive and secure');
});

const server = createServer(app);
const io = new Server(server, {
    cors: { 
        origin: SAFE_ORIGIN, 
        methods: ["GET", "POST"] 
    }
});

let standbyQueue = [];
let activePairs = {}; 

// V2.0 COMPLIANCE: UUID Banning instead of IP Banning
const banned_uuids = new Set();

// V2.0 SECURITY: Anti-DDoS Spam Tracker
let spam_cache = {};

// We now expect the frontend to pass a UUID when connecting
io.use((socket, next) => {
    const user_uuid = socket.handshake.auth.token;
    
    if (!user_uuid) {
        return next(new Error("authentication error: missing UUID"));
    }
    
    if (banned_uuids.has(user_uuid)) {
        return next(new Error("access denied: UUID banned"));
    }
    
    socket.user_uuid = user_uuid;
    next();
});

io.on('connection', (socket) => {
    console.log(`Verified user connected: ${socket.id} (UUID: ${socket.user_uuid})`);

    socket.on('find_partner', () => {
        let uid = socket.user_uuid;
        let now_ms = Date.now();

        // 1. Initialize their tracker if they don't have one
        if (!spam_cache[uid]) {
            spam_cache[uid] = { strikes: 0, last_hit: now_ms };
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
                banned_uuids.add(uid);
                socket.emit('you_got_banned', { msg: 'Connection dropped due to spamming.' });
                socket.disconnect(true);
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

            socket.emit('matched', { roomId: sessionRoomId, createOffer: true });
            io.to(peerId).emit('matched', { roomId: sessionRoomId, createOffer: false });
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
                // Ban the reported user by UUID
                const badGuyUUID = badGuySocket.user_uuid;
                banned_uuids.add(badGuyUUID);
                console.log(`[SECURITY] BANNED UUID: ${badGuyUUID}`);

                // Tell the bad guy they are banned and sever their connection
                badGuySocket.emit('you_got_banned', { msg: 'You were reported for violating terms.' });
                badGuySocket.disconnect(true);
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