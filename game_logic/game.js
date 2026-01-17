const onnx = require('onnxruntime-node');
const path = require('path');

class IncanGoldGame {
    constructor(roomId) {
        this.roomId = roomId;
        this.players = []; 
        this.gameState = 'waiting'; 
        this.currentRound = 0;
        this.deck = [];
        this.explorersInTemple = []; 
        this.artifactDeck = [5, 7, 8, 10, 12]; 
        this.permanentlyRemovedHazards = []; 
        this.cardTreasures = []; 
        this.revealedHazards = {}; 
        this.playerDecisions = {};
        this.playerConfirmed = {};
        this.waitingForDecisions = false;
        this.winner = null;
        this.aiSession = null;
        this.hasBots = false;
        this.loadAiModel();
    }

    async loadAiModel() {
        try {
            const modelPath = path.join(__dirname, '..', 'incan_gold_selfplay_final.onnx');
            this.aiSession = await onnx.InferenceSession.create(modelPath);
            console.log(`🤖 AI模型加载成功`);
        } catch (e) {
            console.error('AI加载失败:', e.message);
        }
    }

    addPlayer(playerId, playerName) {
        this.players.push({ 
            id: playerId, name: playerName, treasures: 0, 
            roundGains: 0, status: 'waiting', isReady: false, isBot: false 
        });
    }

    addBot() {
        const botId = `bot_${Math.random().toString(36).substr(2, 5)}`;
        this.players.push({
            id: botId, name: `🤖 AI-${this.players.filter(p=>p.isBot).length + 1}`,
            treasures: 0, roundGains: 0, status: 'waiting', isReady: true, isBot: true
        });
        this.hasBots = true;
    }

    toggleReady(playerId) {
        const p = this.players.find(p => p.id === playerId);
        if (p) p.isReady = !p.isReady;
    }

    removePlayer(playerId) {
        const index = this.players.findIndex(p => p.id === playerId);
        if (index !== -1) {
            this.players.splice(index, 1);
            this.explorersInTemple = this.explorersInTemple.filter(id => id !== playerId);
            if (this.players.length > 0 && index === 0) this.players[0].isReady = false;
            return true;
        }
        return false;
    }

    startGame() {
        if (this.players.length < 2) throw new Error('至少需要2人');
        if (!this.players.every(p => p.isReady)) throw new Error('有人未准备');
        this.gameState = 'playing';
        this.currentRound = 1;
        this.players.forEach(p => { p.treasures = 0; p.roundGains = 0; });
        this.permanentlyRemovedHazards = [];
        this.shuffleArray(this.artifactDeck);
    }

    resetGame() {
        this.gameState = 'waiting';
        this.players.forEach(p => {
            p.status = 'waiting';
            p.isReady = p.isBot;
            p.treasures = 0;
            p.roundGains = 0;
        });
    }

    initializeDeck() {
        const treasures = [1, 2, 3, 4, 5, 5, 7, 7, 9, 11, 11, 13, 14, 15, 17];
        const hazards = ['snake', 'spider', 'mummy', 'fire', 'rocks'];
        let hazardCards = [];
        hazards.forEach(h => {
            const count = 3 - this.permanentlyRemovedHazards.filter(rh => rh === h).length;
            for(let i = 0; i < count; i++) hazardCards.push(h);
        });
        this.deck = [...treasures, ...hazardCards];
        if (this.currentRound <= 5) this.deck.push(`artifact_${this.artifactDeck[this.currentRound - 1]}`);
        this.shuffleArray(this.deck);
    }

    startRound(io) {
        this.players.forEach(p => { p.status = 'exploring'; p.roundGains = 0; });
        this.explorersInTemple = this.players.map(p => p.id);
        this.cardTreasures = []; 
        this.revealedHazards = {};
        this.initializeDeck();
        io.to(this.roomId).emit('roundStarted', { round: this.currentRound, players: this.getPlayersForBroadcast() });
        setTimeout(() => this.drawCard(io), 2000);
    }

    async makeBotDecisions(io) {
        const bots = this.explorersInTemple.map(id => this.players.find(p => p.id === id)).filter(p => p && p.isBot);
        if (bots.length === 0) return;
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
        for (const bot of bots) {
            const pathRem = this.cardTreasures.reduce((s, v) => typeof v === 'number' ? s + v : s, 0);
            const artCnt = this.cardTreasures.filter(c => typeof c === 'string' && c.startsWith('artifact')).length;
            const input = Float32Array.from([
                this.currentRound, bot.roundGains, pathRem, artCnt,
                this.revealedHazards['snake']||0, this.revealedHazards['spider']||0, this.revealedHazards['mummy']||0,
                this.revealedHazards['fire']||0, this.revealedHazards['rocks']||0, this.deck.length, this.explorersInTemple.length
            ]);
            let action = 'continue';
            if (this.aiSession) {
                const results = await this.aiSession.run({ input: new onnx.Tensor('float32', input, [1, 11]) });
                if (results.output.data[1] > results.output.data[0]) action = 'return';
            }
            this.playerAction(bot.id, action);
            this.confirmPlayerAction(bot.id);
        }
        this.checkAndProceedAfterDecision(io);
    }

    drawCard(io) {
        if (this.explorersInTemple.length === 0) return this.endRound(io);
        const card = this.deck.pop();
        if (typeof card === 'number') this.cardTreasures.push(card);
        else if (typeof card === 'string' && card.startsWith('artifact_')) this.cardTreasures.push(card);
        else {
            this.revealedHazards[card] = (this.revealedHazards[card] || 0) + 1;
            this.cardTreasures.push(`hazard_${card}`);
            if (this.revealedHazards[card] === 2) {
                this.permanentlyRemovedHazards.push(card);
                io.to(this.roomId).emit('cardRevealed', { cardTreasures: this.cardTreasures, players: this.getPlayersForBroadcast() });
                const summary = this.players.map(p => ({ name: p.name, status: this.explorersInTemple.includes(p.id) ? 'dead' : 'safe', roundGains: p.roundGains }));
                io.to(this.roomId).emit('hazardTriggered', { hazard: card });
                io.to(this.roomId).emit('roundSummary', summary);
                this.explorersInTemple = [];
                return setTimeout(() => this.endRound(io), 4000);
            }
        }
        io.to(this.roomId).emit('cardRevealed', { cardTreasures: this.cardTreasures, players: this.getPlayersForBroadcast() });
        this.waitingForDecisions = true;
        this.explorersInTemple.forEach(id => { this.playerDecisions[id] = 'pending'; this.playerConfirmed[id] = false; });
        if (this.hasBots) this.makeBotDecisions(io);
    }

    playerAction(id, act) { if (!this.waitingForDecisions) return false; this.playerDecisions[id] = act; return true; }
    confirmPlayerAction(id) { if (this.playerDecisions[id] === 'pending') return false; this.playerConfirmed[id] = true; return true; }

    processDecisions(io) {
        this.waitingForDecisions = false;
        const quitters = this.explorersInTemple.filter(id => this.playerDecisions[id] === 'return');
        const stayers = this.explorersInTemple.filter(id => this.playerDecisions[id] === 'continue');
        let details = [];
        if (quitters.length > 0) {
            let perPerson = 0;
            this.cardTreasures.forEach((val, idx) => {
                if (typeof val === 'number') {
                    perPerson += Math.floor(val / quitters.length);
                    this.cardTreasures[idx] = val % quitters.length;
                }
            });
            let artVal = 0;
            if (quitters.length === 1) {
                this.cardTreasures.forEach((val, idx) => {
                    if (typeof val === 'string' && val.startsWith('artifact_')) {
                        artVal += parseInt(val.split('_')[1]);
                        this.cardTreasures[idx] = 'collected';
                    }
                });
            }
            quitters.forEach(id => {
                const p = this.players.find(pl => pl.id === id);
                p.status = 'camp'; p.treasures += (perPerson + artVal); p.roundGains += (perPerson + artVal);
                details.push({ name: p.name, share: perPerson, artifact: artVal });
            });
        }
        this.explorersInTemple = stayers;
        io.to(this.roomId).emit('decisionsRevealed', { quitterDetails: details, cardTreasures: this.cardTreasures, players: this.getPlayersForBroadcast(), decisions: this.playerDecisions });
        if (this.explorersInTemple.length === 0) {
            const summary = this.players.map(p => ({ name: p.name, status: 'safe', roundGains: p.roundGains }));
            io.to(this.roomId).emit('roundSummary', summary);
            setTimeout(() => this.endRound(io), 3000);
        } else setTimeout(() => this.drawCard(io), 3000);
    }

    checkAndProceedAfterDecision(io) {
        if (this.explorersInTemple.length > 0 && this.explorersInTemple.every(id => this.playerConfirmed[id])) {
            this.processDecisions(io);
        }
    }

    endRound(io) {
        this.players.forEach(p => p.status = 'camp');
        if (this.currentRound >= 5) {
            const sorted = [...this.players].sort((a, b) => b.treasures - a.treasures);
            io.to(this.roomId).emit('gameFinished', { winner: sorted[0].name, scores: this.getPlayersForBroadcast() });
        } else {
            this.currentRound++;
            io.to(this.roomId).emit('roundEnded', { round: this.currentRound - 1 });
            setTimeout(() => this.startRound(io), 4000);
        }
    }

    getPlayersForBroadcast() { return this.players.map(p => ({ id: p.id, name: p.name, treasures: p.treasures, roundGains: p.roundGains, status: p.status, isReady: p.isReady, isBot: p.isBot })); }
    shuffleArray(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } }
}
module.exports = IncanGoldGame;