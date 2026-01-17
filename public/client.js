let socket;
let currentRoomId, myPlayerId, isHost = false;

const IS_DEBUG = true; 
const URL = IS_DEBUG ? 'http://localhost:3000' : 'https://你的项目.replit.app';

const ui = {
    setup: document.getElementById('setup-screen'),
    game: document.getElementById('game-screen'),
    players: document.getElementById('players-list'),
    cards: document.getElementById('revealed-cards'),
    actions: document.getElementById('action-buttons'),
    confirms: document.getElementById('confirm-buttons'),
    status: document.getElementById('game-status'),
    round: document.getElementById('round-number'),
    log: document.getElementById('log'),
    startBtn: document.getElementById('start-game-btn'),
    readyBtn: document.getElementById('ready-btn'),
    addBotBtn: document.getElementById('add-bot-btn'),
    roomId: document.getElementById('room-id-display'),
    resultOverlay: null 
};

function initSocket() {
    socket = io(URL);

    socket.on('roomCreated', d => {
        currentRoomId = d.roomId; myPlayerId = d.playerId; isHost = true;
        ui.setup.style.display = 'none'; ui.game.style.display = 'block';
        ui.roomId.textContent = d.roomId;
    });

    socket.on('joinedRoom', d => {
        currentRoomId = d.roomId; myPlayerId = d.playerId; isHost = false;
        ui.setup.style.display = 'none'; ui.game.style.display = 'block';
        ui.roomId.textContent = d.roomId;
    });

    socket.on('playersUpdated', d => updatePlayersList(d.players));

    socket.on('gameStarted', d => {
        ui.startBtn.style.display = 'none';
        ui.readyBtn.style.display = 'none';
        ui.addBotBtn.style.display = 'none';
        if(ui.resultOverlay) ui.resultOverlay.style.display = 'none';
        addToLog("🔥 游戏开始！");
    });

    socket.on('roundStarted', d => {
        ui.round.textContent = d.round;
        ui.cards.innerHTML = '';
        updatePlayersList(d.players);
        addToLog(`--- 第 ${d.round} 回合开始 ---`);
    });

    socket.on('cardRevealed', d => {
        renderPath(d.cardTreasures);
        const me = d.players.find(p => p.id === myPlayerId);
        if (me && me.status === 'exploring') {
            ui.actions.style.display = 'block';
            ui.confirms.style.display = 'none';
            ui.status.textContent = '🤔 继续还是返回？';
        } else {
            ui.status.textContent = '👀 观战中...';
        }
    });

    socket.on('decisionsRevealed', d => {
        renderPath(d.cardTreasures);
        updatePlayersList(d.players);
        d.quitterDetails.forEach(q => addToLog(`💰 [返回] ${q.name} 带回: ${q.share} 💎${q.artifact>0?' +🗿神器':''}`));
        const stayers = Object.values(d.decisions).filter(v => v === 'continue').length;
        if(stayers > 0) addToLog(`🤠 ${stayers} 人选择继续探险...`);
    });

    socket.on('roundSummary', summary => {
        addToLog(`📊 --- 本轮结算 ---`);
        summary.forEach(s => addToLog(`${s.status === 'safe'?'✅':'💀'} ${s.name}: ${s.status === 'safe'?'得 '+s.roundGains+'💎':'颗粒无收'}`));
    });

    socket.on('gameFinished', d => showLeaderboard(d.scores));

    socket.on('gameReset', d => {
        if(ui.resultOverlay) ui.resultOverlay.style.display = 'none';
        ui.log.innerHTML = '';
        addToLog("🔄 游戏已重置");
        updatePlayersList(d.players);
        ui.cards.innerHTML = '';
        ui.round.textContent = '1';
    });

    socket.on('error', m => alert(m));
}

initSocket();

// --- Click Events ---
document.getElementById('create-room-btn').onclick = () => {
    const n = document.getElementById('player-name').value.trim();
    if(n) socket.emit('createRoom', n);
};
document.getElementById('join-room-btn').onclick = () => {
    const n = document.getElementById('player-name').value.trim();
    const r = document.getElementById('room-id-input').value.trim().toUpperCase();
    if(n && r) socket.emit('joinRoom', { roomId: r, playerName: n });
};
ui.readyBtn.onclick = () => socket.emit('toggleReady', currentRoomId);
ui.startBtn.onclick = () => socket.emit('startGame', currentRoomId);
ui.addBotBtn.onclick = () => socket.emit('addBot', { roomId: currentRoomId });

document.getElementById('explore-btn').onclick = () => {
    socket.emit('playerAction', { roomId: currentRoomId, action: 'continue' });
    ui.actions.style.display = 'none'; ui.confirms.style.display = 'block';
};
document.getElementById('return-btn').onclick = () => {
    socket.emit('playerAction', { roomId: currentRoomId, action: 'return' });
    ui.actions.style.display = 'none'; ui.confirms.style.display = 'block';
};
document.getElementById('confirm-btn').onclick = () => {
    socket.emit('confirmAction', { roomId: currentRoomId });
    ui.confirms.style.display = 'none'; ui.status.textContent = '已确认...';
};
document.getElementById('cancel-btn').onclick = () => {
    ui.confirms.style.display = 'none'; ui.actions.style.display = 'block';
};

function updatePlayersList(players) {
    ui.players.innerHTML = '';
    const isPlaying = players.some(p => p.status !== 'waiting');
    players.forEach((p, idx) => {
        const div = document.createElement('div');
        div.className = `player-card ${p.status} ${p.isBot?'bot-card':''}`;
        let status = isPlaying ? (p.status === 'exploring' ? '🤠 探险中' : (p.status === 'camp' ? '⛺ 已撤退' : '💀 已牺牲')) 
                               : (p.isBot ? '🤖 AI 就绪' : (p.isReady ? '● 已准备' : '○ 未准备'));
        div.innerHTML = `<strong>${p.name}</strong> ${idx===0?'👑':''}<br>${status}<br>💎 库存: ${p.treasures}`;
        ui.players.appendChild(div);
    });

    if(!isPlaying) {
        ui.readyBtn.style.display = 'block';
        if(isHost) {
            ui.addBotBtn.style.display = 'block';
            ui.startBtn.style.display = 'block';
            const allReady = players.every(p => p.isReady);
            ui.startBtn.disabled = players.length < 2 || !allReady;
        }
    } else {
        ui.addBotBtn.style.display = ui.startBtn.style.display = ui.readyBtn.style.display = 'none';
    }
}

function renderPath(treasures) {
    ui.cards.innerHTML = '';
    treasures.forEach(val => {
        if(val === 'looted' || val === 'collected') return; 
        const card = document.createElement('div');
        if (typeof val === 'number') {
            card.className = 'card treasure';
            card.innerHTML = `<div class="card-value">${val}</div><div>💎 宝石</div>`;
        } else if (val.startsWith('artifact_')) {
            card.className = 'card artifact';
            card.innerHTML = `<div class="card-value">${val.split('_')[1]}</div><div>🗿 神器</div>`;
        } else if (val.startsWith('hazard_')) {
            card.className = 'card hazard';
            const icons = {'snake':'🐍','spider':'🕷️','mummy':'🧟','fire':'🔥','rocks':'🪨'};
            card.innerHTML = `<div class="card-value">${icons[val.split('_')[1]]}</div>`;
        }
        ui.cards.appendChild(card);
    });
}

function showLeaderboard(scores) {
    if(!ui.resultOverlay) {
        ui.resultOverlay = document.createElement('div');
        ui.resultOverlay.id = 'result-overlay';
        document.body.appendChild(ui.resultOverlay);
    }
    ui.resultOverlay.style.display = 'flex';
    scores.sort((a,b) => b.treasures - a.treasures);
    const max = Math.max(...scores.map(s => s.treasures)) || 1;
    let html = `<div class="result-box"><h1>🏆 最终战绩</h1>`;
    scores.forEach((p, i) => {
        html += `<div class="result-row">${i+1}. ${p.name} - ${p.treasures}💎
        <div class="progress-bg"><div class="progress-bar" style="width:${(p.treasures/max)*100}%"></div></div></div>`;
    });
    if(isHost) html += `<button class="restart-btn" onclick="socket.emit('restartGame', currentRoomId)">🔄 重新开始</button>`;
    ui.resultOverlay.innerHTML = html + `</div>`;
}

function addToLog(m) {
    const e = document.createElement('div');
    e.textContent = `[${new Date().toLocaleTimeString()}] ${m}`;
    ui.log.appendChild(e); ui.log.scrollTop = ui.log.scrollHeight;
}