let socket;
let currentRoomId, myPlayerId, isHost;

// 如果是发布模式请修改这里
const IS_DEBUG = true; 
const PROD_URL = 'https://你的项目名.replit.app'; 
const LOCAL_URL = 'http://localhost:3000';

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
    // 新增：添加机器人按钮容器
    hostControls: document.getElementById('host-controls') || createHostControls(),
    roomId: document.getElementById('room-id-display'),
    resultOverlay: document.getElementById('result-overlay') || createResultOverlay()
};

function initSocket() {
    const url = IS_DEBUG ? LOCAL_URL : PROD_URL;
    socket = io(url);

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
        ui.hostControls.style.display = 'none'; // 游戏开始隐藏加AI按钮
        ui.resultOverlay.style.display = 'none';
        addToLog("🔥 游戏开始！前往印加古庙...");
    });

    socket.on('roundStarted', d => {
        ui.round.textContent = d.round;
        ui.cards.innerHTML = '';
        ui.status.textContent = '探险中...';
        updatePlayersList(d.players); // 立即刷新状态
        addToLog(`--- 第 ${d.round} 回合开始 ---`);
    });

    socket.on('cardRevealed', d => {
        renderPath(d.cardTreasures);
        const me = d.players.find(p => p.id === myPlayerId);
        if (me && me.status === 'exploring') {
            ui.actions.style.display = 'block';
            ui.confirms.style.display = 'none';
            ui.status.textContent = '🤔 请决策：继续还是返回？';
        } else {
            ui.actions.style.display = 'none'; 
            ui.confirms.style.display = 'none';
            ui.status.textContent = '👀 观战中...';
        }
    });

    socket.on('decisionsRevealed', d => {
        renderPath(d.cardTreasures);
        updatePlayersList(d.players); // 立即刷新状态
        
        d.quitterDetails.forEach(q => {
            const artifactText = q.artifact > 0 ? ` + 🗿神器(${q.artifact}分)` : '';
            addToLog(`💰 [返回] ${q.name} 成功带回: ${q.share} 💎${artifactText}`);
        });

        const continuing = [];
        for(let id in d.decisions) {
            if (d.decisions[id] === 'continue') {
                const player = d.players.find(p => p.id === id);
                if(player) continuing.push(player.name);
            }
        }
        if (continuing.length > 0) addToLog(`🤠 [继续] ${continuing.join(', ')} 深入探险...`);
    });
    
    socket.on('gameReset', d => {
        ui.resultOverlay.style.display = 'none';
        ui.game.style.display = 'block';
        ui.log.innerHTML = '';
        addToLog("🔄 游戏已重置");
        updatePlayersList(d.players);
        ui.cards.innerHTML = '';
        ui.status.textContent = '';
        ui.round.textContent = '1';
    });

    socket.on('hazardTriggered', d => addToLog(`⚠️ 灾难触发: ${d.hazard.toUpperCase()}! 😱`));

    socket.on('roundSummary', summary => {
        addToLog(`📊 --- 本轮结算 ---`);
        summary.forEach(s => {
            if(s.status === 'safe') {
                addToLog(`✅ ${s.name}: 成功带回 ${s.roundGains} 💎`);
            } else {
                addToLog(`💀 ${s.name}: 遭遇灾难，颗粒无收`);
            }
        });
        ui.actions.style.display = 'none'; 
        ui.confirms.style.display = 'none';
        ui.status.textContent = '本轮结束，结算中...';
    });
    
    socket.on('roundEnded', d => {
        addToLog(`⏳ 第 ${d.round} 回合结束，准备进入下一轮...`);
    });

    socket.on('gameFinished', d => {
        ui.status.textContent = `🏆 游戏结束`;
        addToLog(`🎉 游戏结束！`);
        showLeaderboard(d.scores);
    });

    socket.on('error', m => alert(m));
}

// 启动
initSocket();

// --- 绑定事件 ---
document.getElementById('create-room-btn').onclick = () => {
    const name = document.getElementById('player-name').value.trim();
    if(name) socket.emit('createRoom', name);
};
document.getElementById('join-room-btn').onclick = () => {
    const name = document.getElementById('player-name').value.trim();
    const rId = document.getElementById('room-id-input').value.trim().toUpperCase();
    if(name && rId) socket.emit('joinRoom', { roomId: rId, playerName: name });
};
ui.readyBtn.onclick = () => socket.emit('toggleReady', currentRoomId);
ui.startBtn.onclick = () => socket.emit('startGame', currentRoomId);

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
    ui.confirms.style.display = 'none'; ui.status.textContent = '已确认，等待他人...';
};
document.getElementById('cancel-btn').onclick = () => {
    ui.confirms.style.display = 'none'; ui.actions.style.display = 'block';
};

// --- UI 渲染函数 ---

function createResultOverlay() {
    const div = document.createElement('div');
    div.id = 'result-overlay';
    div.style.display = 'none';
    document.body.appendChild(div);
    return div;
}

function createHostControls() {
    // 如果HTML里没有，动态创建一个控制栏
    const controls = document.getElementById('controls');
    const div = document.createElement('div');
    div.id = 'host-controls';
    div.style.marginBottom = '10px';
    controls.insertBefore(div, controls.firstChild);
    return div;
}

document.getElementById('add-bot-btn').onclick = () => {
    socket.emit('addBot', currentRoomId);
};

function updatePlayersList(players) {
    ui.players.innerHTML = '';
    const isPlaying = players.some(p => p.status !== 'waiting');
    
    players.forEach((p, index) => {
        const div = document.createElement('div');
        // 增加 bot-card 类名，方便你在 CSS 里给 AI 玩家加个淡紫色背景（可选）
        div.className = `player-card ${p.status} ${p.isBot ? 'bot-card' : ''}`;
        
        // 房主图标 (保持你现有的 index 0 逻辑)
        const isHostPlayer = index === 0; 
        
        let statusHtml = '';
        if (isPlaying) {
            // --- 游戏进行中：不论是 AI 还是人类，都显示当前行动状态 ---
            if (p.status === 'exploring') {
                statusHtml = '<span style="color:#e67e22; font-weight:bold;">🤠 探险中</span>';
            } else if (p.status === 'camp') {
                statusHtml = '<span style="color:#7f8c8d;">⛺ 已撤退</span>';
            } else {
                statusHtml = '<span style="color:#e74c3c;">💀 已牺牲</span>';
            }
        } else {
            // --- 等待大厅：区分 AI 和 人类 的准备状态 ---
            if (p.isBot) {
                // AI 默认显示紫色已就绪状态
                statusHtml = '<span style="color:#8e44ad; font-weight:bold;">🤖 AI 已就绪</span>';
            } else {
                statusHtml = p.isReady 
                    ? '<span style="color:#2ecc71; font-weight:bold;">● 已准备</span>' 
                    : '<span style="color:#e74c3c; font-weight:bold;">○ 未准备</span>';
            }
        }
        
        // --- 构造 HTML 模板 ---
        div.innerHTML = `
            <div style="margin-bottom:5px; display:flex; align-items:center; justify-content:space-between;">
                <span>
                    <strong>${p.name}</strong> ${isHostPlayer ? '👑' : ''}
                </span>
                ${p.isBot ? '<span style="font-size:10px; background:#8e44ad; color:white; padding:1px 4px; border-radius:3px; margin-left:5px;">AI</span>' : ''}
            </div>
            <div style="font-size:0.9em;">${statusHtml}</div>
            <div style="font-size:0.9em; margin-top:3px; color:#555;">💎 库存: <strong>${p.treasures}</strong></div>
        `;
        ui.players.appendChild(div);
    });

    // 按钮逻辑
    if(!isPlaying) {
        ui.readyBtn.style.display = 'block';
        const me = players.find(p => p.id === myPlayerId);
        if (me) {
            ui.readyBtn.textContent = me.isReady ? '取消准备' : '准备';
            ui.readyBtn.className = me.isReady ? 'cancel-ready-btn' : 'ready-btn'; 
        }

        if(isHost) {
            ui.startBtn.style.display = 'block';
            ui.hostControls.style.display = 'block';
            
            // 渲染加机器人按钮
            ui.hostControls.innerHTML = '';
            const addBotBtn = document.createElement('button');
            addBotBtn.textContent = '🤖 添加 AI 玩家';
            addBotBtn.style.backgroundColor = '#8e44ad';
            addBotBtn.style.color = 'white';
            addBotBtn.style.width = '100%';
            addBotBtn.style.marginBottom = '5px';
            addBotBtn.onclick = () => socket.emit('addBot', { roomId: currentRoomId, difficulty: 'normal' });
            ui.hostControls.appendChild(addBotBtn);

            const allReady = players.every(p => p.isReady);
            // 只要总人数 >= 2 即可开始 (哪怕是1人+1机器人)
            const canStart = players.length >= 2 && allReady;
            ui.startBtn.disabled = !canStart;
            
            if (players.length < 2) ui.startBtn.textContent = '等待玩家...';
            else if (!me.isReady) ui.startBtn.textContent = '请您先准备';
            else if (!allReady) ui.startBtn.textContent = '等待他人准备';
            else ui.startBtn.textContent = '▶ 开始游戏';
        } else {
            ui.startBtn.style.display = 'none';
            ui.hostControls.style.display = 'none';
        }
    } else {
        ui.startBtn.style.display = 'none';
        ui.readyBtn.style.display = 'none';
        ui.hostControls.style.display = 'none';
    }
}

function renderPath(treasures) {
    ui.cards.innerHTML = '';
    treasures.forEach(val => {
        if(val === 'looted' || val === 'collected') return; 
        
        const card = document.createElement('div');
        
        if (typeof val === 'number' && val > 0) {
            card.className = 'card treasure';
            card.innerHTML = `<div class="card-value">${val}</div><div style="font-size:12px;">💎 宝石</div>`;
            ui.cards.appendChild(card);
        } else if (typeof val === 'string' && val.startsWith('artifact_')) {
            const artVal = val.split('_')[1];
            card.className = 'card artifact';
            card.innerHTML = `<div class="card-value">${artVal}</div><div style="font-size:12px;">🗿 神器</div>`;
            ui.cards.appendChild(card);
        } else if (typeof val === 'string' && val.startsWith('hazard_')) {
            card.className = 'card hazard';
            const hType = val.split('_')[1];
            const hIcons = {'snake':'🐍','spider':'🕷️','mummy':'🧟','fire':'🔥','rocks':'🪨'};
            card.innerHTML = `<div class="card-value">${hIcons[hType]||'💀'}</div><div style="font-size:12px;">${hType}</div>`;
            ui.cards.appendChild(card);
        }
    });
}

function showLeaderboard(scores) {
    const overlay = ui.resultOverlay;
    overlay.innerHTML = '';
    overlay.style.display = 'flex';
    
    const box = document.createElement('div');
    box.className = 'result-box';
    box.innerHTML = `<h1>🏆 最终战绩</h1>`;
    
    // 排序已经在前端通过 display 逻辑做，这里后端虽然排了序，前端再排一次保险
    scores.sort((a,b) => b.treasures - a.treasures);
    const maxScore = Math.max(...scores.map(s => s.treasures)) || 1;
    
    const list = document.createElement('div');
    list.style.width = '100%';
    
    scores.forEach((p, idx) => {
        const row = document.createElement('div');
        row.className = 'result-row';
        const percent = (p.treasures / maxScore) * 100;
        
        let medal = '';
        if(idx === 0) medal = '🥇';
        else if(idx === 1) medal = '🥈';
        else if(idx === 2) medal = '🥉';
        else medal = `${idx+1}.`;
        
        row.innerHTML = `
            <div class="result-info">
                <span style="width:30px;">${medal}</span>
                <span style="font-weight:bold;">${p.name}</span>
                <span style="margin-left:auto; font-size:1.2em;">${p.treasures} 💎</span>
            </div>
            <div class="progress-bg">
                <div class="progress-bar" style="width: ${percent}%;"></div>
            </div>
        `;
        list.appendChild(row);
    });
    box.appendChild(list);
    
    if(isHost) {
        const restartBtn = document.createElement('button');
        restartBtn.textContent = '🔄 重新开始';
        restartBtn.className = 'restart-btn';
        restartBtn.onclick = () => socket.emit('restartGame', currentRoomId);
        box.appendChild(restartBtn);
    } else {
        const waitMsg = document.createElement('div');
        waitMsg.textContent = '等待房主重新开始...';
        waitMsg.style.marginTop = '20px';
        waitMsg.style.color = '#777';
        box.appendChild(waitMsg);
    }
    overlay.appendChild(box);
}

function addToLog(m) {
    const e = document.createElement('div');
    e.textContent = `[${new Date().toLocaleTimeString().split(' ')[0]}] ${m}`;
    ui.log.appendChild(e); ui.log.scrollTop = ui.log.scrollHeight;
}