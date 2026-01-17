// game_logic/game.js

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
    }

    addPlayer(playerId, playerName) {
        if (this.gameState !== 'waiting') throw new Error('游戏已经开始，无法加入');
        const isHost = this.players.length === 0;
        this.players.push({ 
            id: playerId, 
            name: playerName, 
            treasures: 0, 
            roundGains: 0, // 新增：记录本回合暂存/获得的收益
            status: 'waiting',
            isReady: false 
        });
    }

    toggleReady(playerId) {
        const player = this.players.find(p => p.id === playerId);
        if (player) {
            player.isReady = !player.isReady;
            return true;
        }
        return false;
    }

    removePlayer(playerId) {
        const index = this.players.findIndex(p => p.id === playerId);
        if (index !== -1) {
            this.players.splice(index, 1);
            this.explorersInTemple = this.explorersInTemple.filter(id => id !== playerId);
            if (this.players.length === 0) {
                // 房间空了，通常由server处理删除
            } else if (index === 0 && this.players[0]) {
                this.players[0].isReady = false;
            }
            return true;
        }
        return false;
    }

    startGame() {
        if (this.players.length < 2) throw new Error('至少需要 2 名玩家');
        if (!this.players.every(p => p.isReady)) throw new Error('还有玩家未准备好');
        
        this.gameState = 'playing';
        this.currentRound = 1;
        // 重置所有人的总分（针对重开的情况）
        this.players.forEach(p => p.treasures = 0);
        this.permanentlyRemovedHazards = []; // 重置移除的灾难
        this.shuffleArray(this.artifactDeck);
    }

    // 新增：重置游戏逻辑
    resetGame() {
        this.gameState = 'waiting';
        this.currentRound = 0;
        this.winner = null;
        this.players.forEach(p => {
            p.status = 'waiting';
            p.isReady = false;
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
        if (this.currentRound <= 5) {
            this.deck.push(`artifact_${this.artifactDeck[this.currentRound - 1]}`);
        }
        this.shuffleArray(this.deck);
    }

    startRound(io) {
        this.players.forEach(p => {
            p.status = 'exploring';
            p.roundGains = 0; // 新回合收益清零
        });
        this.explorersInTemple = this.players.map(p => p.id);
        this.cardTreasures = []; 
        this.revealedHazards = {};
        this.initializeDeck();
        
        if (io) io.to(this.roomId).emit('roundStarted', { round: this.currentRound, players: this.getPlayersForBroadcast() });
        setTimeout(() => this.drawCard(io), 2000);
    }

    drawCard(io) {
        if (this.explorersInTemple.length === 0) return this.endRound(io);
        if (this.deck.length === 0) return this.endRound(io);

        const card = this.deck.pop();
        let isHazardTrigger = false;

        if (typeof card === 'number') {
            this.cardTreasures.push(card); 
        } else if (typeof card === 'string' && card.startsWith('artifact_')) {
            this.cardTreasures.push(card);
        } else {
            this.revealedHazards[card] = (this.revealedHazards[card] || 0) + 1;
            this.cardTreasures.push(`hazard_${card}`);
            if (this.revealedHazards[card] === 2) {
                isHazardTrigger = true;
            }
        }

        if (io) {
            io.to(this.roomId).emit('cardRevealed', { 
                cardTreasures: this.cardTreasures,
                players: this.getPlayersForBroadcast() 
            });
        }

        if (isHazardTrigger) {
            this.handleHazardTrigger(io, card);
            return;
        }

        this.waitingForDecisions = true;
        this.explorersInTemple.forEach(id => {
            this.playerDecisions[id] = 'pending';
            this.playerConfirmed[id] = false;
        });
    }

    handleHazardTrigger(io, hazardType) {
        this.permanentlyRemovedHazards.push(hazardType.split('_')[1] || hazardType);
        
        // 结算：在神庙里的人，本轮收益(roundGains)全部失效（本来就是0，不用管），且没分到任何东西
        // 已经在营地的人，保持他们的 roundGains
        const summary = this.players.map(p => ({
            name: p.name,
            status: this.explorersInTemple.includes(p.id) ? 'dead' : 'safe',
            roundGains: p.roundGains // 只显示本轮赚的
        }));

        io.to(this.roomId).emit('hazardTriggered', { hazard: hazardType });
        io.to(this.roomId).emit('roundSummary', summary);

        this.explorersInTemple = []; 
        setTimeout(() => this.endRound(io), 4000);
    }

    playerAction(playerId, action) {
        if (!this.waitingForDecisions) return false;
        this.playerDecisions[playerId] = action;
        return true;
    }

    confirmPlayerAction(playerId) {
        if (!this.waitingForDecisions || this.playerDecisions[playerId] === 'pending') return null;
        this.playerConfirmed[playerId] = true;
        return { playerId, playerName: this.players.find(p => p.id === playerId).name, action: this.playerDecisions[playerId] };
    }

    processDecisions(io) {
        this.waitingForDecisions = false;
        const quitters = this.explorersInTemple.filter(id => this.playerDecisions[id] === 'return');
        const stayers = this.explorersInTemple.filter(id => this.playerDecisions[id] === 'continue');
        let quitterDetails = [];

        if (quitters.length > 0) {
            let totalGainedPerPerson = 0;
            const qCount = quitters.length;

            this.cardTreasures.forEach((val, idx) => {
                if (typeof val === 'number' && val > 0) {
                    const share = Math.floor(val / qCount);
                    totalGainedPerPerson += share;
                    this.cardTreasures[idx] = val % qCount; 
                }
            });

            let artValue = 0;
            if (qCount === 1) {
                this.cardTreasures.forEach((val, idx) => {
                    if (typeof val === 'string' && val.startsWith('artifact_')) {
                        artValue += parseInt(val.split('_')[1]);
                        this.cardTreasures[idx] = 'collected'; 
                    }
                });
            }

            quitters.forEach(id => {
                const p = this.players.find(pl => pl.id === id);
                p.status = 'camp';
                const totalRun = totalGainedPerPerson + artValue;
                p.treasures += totalRun; // 总库增加
                p.roundGains += totalRun; // 本轮收益记录增加
                quitterDetails.push({ name: p.name, share: totalGainedPerPerson, artifact: artValue });
            });
        }

        this.explorersInTemple = stayers;
        
        if (io) {
            io.to(this.roomId).emit('decisionsRevealed', {
                decisions: this.playerDecisions,
                quitterDetails: quitterDetails,
                cardTreasures: this.cardTreasures,
                players: this.getPlayersForBroadcast()
            });
        }

        if (this.explorersInTemple.length === 0) {
            // 所有人都走了，生成回合报告
            const summary = this.players.map(p => ({
                name: p.name,
                status: 'safe',
                roundGains: p.roundGains
            }));
            io.to(this.roomId).emit('roundSummary', summary);
            setTimeout(() => this.endRound(io), 3000);
        } else {
            setTimeout(() => this.drawCard(io), 3000);
        }
    }

    checkAndProceedAfterDecision(io) {
        const pendingPlayers = this.explorersInTemple.filter(id => !this.playerConfirmed[id]);
        if (pendingPlayers.length === 0 && this.explorersInTemple.length > 0) {
            this.processDecisions(io);
            return true;
        }
        return false;
    }

    endRound(io) {
        this.players.forEach(p => p.status = 'camp'); // 所有人回营地

        if (this.currentRound >= 5) {
            this.gameState = 'finished';
            
            // 创建一个副本用来找出赢家，保持原数组顺序不变
            const sortedPlayers = [...this.players].sort((a, b) => b.treasures - a.treasures);
            this.winner = sortedPlayers[0].name;
            
            // 发送给前端的数据可以保持原样，前端的 showLeaderboard 会自己排序
            if (io) io.to(this.roomId).emit('gameFinished', { 
                winner: this.winner, 
                scores: this.getPlayersForBroadcast() 
            });
            
        } else {
            const finishedRound = this.currentRound;
            this.currentRound++;
            // 只有不是最后一轮，才发送 "roundEnded"
            if (io) io.to(this.roomId).emit('roundEnded', { round: finishedRound });
            setTimeout(() => this.startRound(io), 4000);
        }
    }

    getPlayersForBroadcast() {
        return this.players.map(p => ({
            id: p.id,
            name: p.name,
            treasures: p.treasures,
            roundGains: p.roundGains, // 广播给前端显示本轮收益
            status: p.status,
            isReady: p.isReady
        }));
    }

    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }
}
module.exports = IncanGoldGame;