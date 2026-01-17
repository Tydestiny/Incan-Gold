const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const IncanGoldGame = require('./game_logic/game');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));
const rooms = {};

function generateRoomId() { return Math.random().toString(36).substring(2, 8).toUpperCase(); }

io.on('connection', (socket) => {
    socket.on('createRoom', (name) => {
        const roomId = generateRoomId();
        const game = new IncanGoldGame(roomId);
        game.addPlayer(socket.id, name);
        rooms[roomId] = game;
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, playerId: socket.id, isHost: true });
        socket.emit('playersUpdated', { players: game.getPlayersForBroadcast() });
    });

    socket.on('joinRoom', ({ roomId, playerName }) => {
        const game = rooms[roomId];
        if (game && game.gameState === 'waiting') {
            game.addPlayer(socket.id, playerName);
            socket.join(roomId);
            const players = game.getPlayersForBroadcast();
            socket.emit('joinedRoom', { roomId, playerId: socket.id, isHost: false, players });
            io.to(roomId).emit('playersUpdated', { players });
        } else {
            socket.emit('error', game ? '游戏正在进行中' : '房间不存在');
        }
    });

    socket.on('toggleReady', (roomId) => {
        const game = rooms[roomId];
        if (game && game.gameState === 'waiting') {
            game.toggleReady(socket.id);
            io.to(roomId).emit('playersUpdated', { players: game.getPlayersForBroadcast() });
        }
    });

    // --- 新增：添加 AI ---
    socket.on('addBot', ({ roomId, difficulty }) => {
        const game = rooms[roomId];
        if (game && game.gameState === 'waiting') {
            game.addBot(difficulty);
            io.to(roomId).emit('playersUpdated', { players: game.getPlayersForBroadcast() });
        }
    });
    // -------------------

    socket.on('startGame', (roomId) => {
        const game = rooms[roomId];
        if (game) {
            try {
                game.startGame();
                io.to(roomId).emit('gameStarted', { round: 1, players: game.getPlayersForBroadcast() });
                game.startRound(io);
            } catch (e) { socket.emit('error', e.message); }
        }
    });

    socket.on('addBot', (roomId) => {
        const game = rooms[roomId];
        // 只有房主且在等待阶段可以添加
        if (game && game.gameState === 'waiting') {
            game.addBot();
            // 广播更新玩家列表
            io.to(roomId).emit('playersUpdated', { players: game.getPlayersForBroadcast() });
        }
    });

    socket.on('restartGame', (roomId) => {
        const game = rooms[roomId];
        if (game) {
            game.resetGame();
            io.to(roomId).emit('gameReset', { players: game.getPlayersForBroadcast() });
        }
    });

    socket.on('playerAction', ({ roomId, action }) => {
        const game = rooms[roomId];
        if (game && game.playerAction(socket.id, action)) {
            io.to(roomId).emit('playerDecided', { playerName: game.players.find(p=>p.id===socket.id).name });
        }
    });

    socket.on('confirmAction', ({ roomId }) => {
        const game = rooms[roomId];
        if (game && game.confirmPlayerAction(socket.id)) {
            socket.emit('actionConfirmed');
            io.to(roomId).emit('playersUpdated', { players: game.getPlayersForBroadcast() });
            setImmediate(() => game.checkAndProceedAfterDecision(io));
        }
    });

    socket.on('disconnect', () => {
        for (const rId in rooms) {
            const game = rooms[rId];
            if (game.removePlayer(socket.id)) {
                io.to(rId).emit('playersUpdated', { players: game.getPlayersForBroadcast() });
                if (game.gameState === 'playing') game.checkAndProceedAfterDecision(io);
                if (game.players.length === 0) delete rooms[rId];
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server is running on port ${PORT}`));