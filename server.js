// PDA 중앙 권위 서버
const http = require('http').createServer((req, res) => {
    res.writeHead(200);
    res.end('PDA Server Running');
});

const io = require('socket.io')(http, {
    cors: { origin: "*" }
});

// ==================== 게임 설정 ====================
const CONFIG = {
    TPS: 60,
    MAP_WIDTH: 210,
    MAP_HEIGHT: 210,
    PLAYER_RADIUS: 1.5,
    BASE_HP: 200,
    BASE_HEAL_RATE: 30,
    VISION_RANGE: 30,
    RESPAWN_TIME: 5,
    XP_PER_LEVEL: 100,
    RECALL_TIME: 3,
};

const WEAPON_SPECS = {
    'melee': {
        damage: 20, attackSpeed: 1.2, range: 3, speed: 25, armor: 0.2,
        dashDist: 12, dashCool: 4, ultDamage: 120, ultRadius: 8, ultCool: 30, ultStun: 1.5
    },
    'ranged': {
        damage: 14, attackSpeed: 0.7, range: 14, speed: 22, armor: 0,
        dashDist: 8, dashCool: 6, ultDamage: 80, ultRadius: 6, ultCool: 25, ultStun: 0
    }
};

const NODE_SPECS = {
    'Base': { radius: 8, hp: 9999, channelTime: 999, dps: 0, range: 0 },
    'Guardian': { radius: 6, hp: 500, channelTime: 9.0, dps: 4.0, range: 10 },
    'T3': { radius: 5, hp: 400, channelTime: 9.1, dps: 6.0, range: 14 },
    'T2': { radius: 7, hp: 300, channelTime: 6.2, dps: 2.5, range: 8 },
    'T1': { radius: 7, hp: 200, channelTime: 3.0, dps: 1.5, range: 5 },
    'Breaker': { radius: 5, hp: 0, channelTime: 8.4, dps: 0, range: 0 },
};

const NODE_POSITIONS = {
    'A_Base': { x: 25, y: 25, type: 'Base', team: 0 },
    'A_Guardian': { x: 50, y: 50, type: 'Guardian', team: 0 },
    'A_T3': { x: 75, y: 75, type: 'T3', team: 0 },
    'A_T2_L': { x: 55, y: 105, type: 'T2', team: 0 },
    'A_T2_R': { x: 105, y: 55, type: 'T2', team: 0 },
    'T1_L': { x: 55, y: 155, type: 'T1', team: -1 },
    'T1_R': { x: 155, y: 55, type: 'T1', team: -1 },
    'B_T2_L': { x: 105, y: 155, type: 'T2', team: 1 },
    'B_T2_R': { x: 155, y: 105, type: 'T2', team: 1 },
    'B_T3': { x: 135, y: 135, type: 'T3', team: 1 },
    'B_Guardian': { x: 160, y: 160, type: 'Guardian', team: 1 },
    'B_Base': { x: 185, y: 185, type: 'Base', team: 1 },
    'Breaker': { x: 105, y: 105, type: 'Breaker', team: -1 },
};

// ==================== 게임 상태 ====================
let lobbyPlayers = [];
let gameStarted = false;
let game = null;
let gameInterval = null;

function initGame() {
    game = {
        tick: 0,
        time: 0,
        players: [],
        nodes: {},
        teams: [{ level: 1, xp: 0 }, { level: 1, xp: 0 }],
        winner: null,
        breakerSpawned: false,
    };
    
    // 노드 초기화
    for (const [id, pos] of Object.entries(NODE_POSITIONS)) {
        const spec = NODE_SPECS[pos.type];
        game.nodes[id] = {
            id, x: pos.x, y: pos.y, type: pos.type,
            owner: pos.team, hp: spec.hp, maxHp: spec.hp,
        };
    }
    
    // 플레이어 초기화 (8명)
    const blueInLobby = lobbyPlayers.filter(p => p.team === 0);
    const redInLobby = lobbyPlayers.filter(p => p.team === 1);
    
    // 블루팀 (4명)
    for (let i = 0; i < 4; i++) {
        const lobbyP = blueInLobby[i];
        game.players.push({
            id: i,
            odI: lobbyP ? lobbyP.id : null,
            team: 0,
            x: 30 + (i % 2) * 10,
            y: 30 + Math.floor(i / 2) * 10,
            hp: CONFIG.BASE_HP,
            maxHp: CONFIG.BASE_HP,
            alive: true,
            isAI: !lobbyP,
            weaponType: i === 0 ? 'melee' : (i % 2 === 0 ? 'melee' : 'ranged'),
            weaponLevel: 1,
            weaponPoints: 0,
            attackCooldown: 0,
            dashCooldown: 0,
            ultCooldown: 0,
            stunTimer: 0,
            respawnTimer: 0,
            channeling: false,
            recalling: false,
            input: { w: false, a: false, s: false, d: false, f: false, b: false, mouseDown: false, mouseX: 0, mouseY: 0 },
            aiTarget: null,
        });
    }
    
    // 레드팀 (4명)
    for (let i = 0; i < 4; i++) {
        const lobbyP = redInLobby[i];
        game.players.push({
            id: i + 4,
            odI: lobbyP ? lobbyP.id : null,
            team: 1,
            x: 180 - (i % 2) * 10,
            y: 180 - Math.floor(i / 2) * 10,
            hp: CONFIG.BASE_HP,
            maxHp: CONFIG.BASE_HP,
            alive: true,
            isAI: !lobbyP,
            weaponType: i % 2 === 0 ? 'melee' : 'ranged',
            weaponLevel: 1,
            weaponPoints: 0,
            attackCooldown: 0,
            dashCooldown: 0,
            ultCooldown: 0,
            stunTimer: 0,
            respawnTimer: 0,
            channeling: false,
            recalling: false,
            input: { w: false, a: false, s: false, d: false, f: false, b: false, mouseDown: false, mouseX: 0, mouseY: 0 },
            aiTarget: null,
        });
    }
}

// ==================== 게임 로직 ====================
function update(dt) {
    if (!game || game.winner !== null) return;
    
    game.tick++;
    game.time += dt;
    
    for (const p of game.players) {
        if (!p.alive) {
            p.respawnTimer -= dt;
            if (p.respawnTimer <= 0) {
                respawn(p);
            }
            continue;
        }
        
        if (p.stunTimer > 0) {
            p.stunTimer -= dt;
            continue;
        }
        
        if (p.isAI) {
            updateAI(p, dt);
        } else {
            updatePlayer(p, dt);
        }
        
        // 쿨다운 감소
        if (p.attackCooldown > 0) p.attackCooldown -= dt;
        if (p.dashCooldown > 0) p.dashCooldown -= dt;
        if (p.ultCooldown > 0) p.ultCooldown -= dt;
    }
    
    // 승리 조건 체크
    checkWinCondition();
}

function updatePlayer(p, dt) {
    const input = p.input;
    
    // 베이스 힐
    if (isAtBase(p) && p.hp < p.maxHp) {
        p.hp = Math.min(p.maxHp, p.hp + CONFIG.BASE_HEAL_RATE * dt);
    }
    
    // 귀환
    if (input.b && !isAtBase(p) && !p.channeling && !p.recalling) {
        p.recalling = true;
        p.recallProgress = 0;
    }
    
    if (p.recalling) {
        if (!input.b || input.w || input.a || input.s || input.d) {
            p.recalling = false;
        } else {
            p.recallProgress += dt;
            if (p.recallProgress >= CONFIG.RECALL_TIME) {
                const baseId = p.team === 0 ? 'A_Base' : 'B_Base';
                const base = game.nodes[baseId];
                p.x = base.x;
                p.y = base.y + (p.team === 0 ? -10 : 10);
                p.hp = p.maxHp;
                p.recalling = false;
            }
        }
        return;
    }
    
    // 이동
    let vx = 0, vy = 0;
    if (input.w) vy -= 1;
    if (input.s) vy += 1;
    if (input.a) vx -= 1;
    if (input.d) vx += 1;
    
    if (vx !== 0 || vy !== 0) {
        const len = Math.sqrt(vx * vx + vy * vy);
        const speed = WEAPON_SPECS[p.weaponType].speed;
        p.x += (vx / len) * speed * dt;
        p.y += (vy / len) * speed * dt;
        p.x = Math.max(5, Math.min(CONFIG.MAP_WIDTH - 5, p.x));
        p.y = Math.max(5, Math.min(CONFIG.MAP_HEIGHT - 5, p.y));
    }
    
    // 공격
    if (input.mouseDown && p.attackCooldown <= 0) {
        tryAttack(p);
    }
}

function updateAI(p, dt) {
    // 간단한 AI - 가장 가까운 적 또는 노드로 이동
    const enemies = game.players.filter(e => e.team !== p.team && e.alive);
    const spec = WEAPON_SPECS[p.weaponType];
    
    // 타겟 선택
    let target = null;
    let minDist = Infinity;
    
    for (const e of enemies) {
        const d = distance(p, e);
        if (d < minDist) {
            minDist = d;
            target = e;
        }
    }
    
    if (!target) return;
    
    // 이동
    const dx = target.x - p.x;
    const dy = target.y - p.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist > spec.range * 0.8) {
        const speed = spec.speed;
        p.x += (dx / dist) * speed * dt;
        p.y += (dy / dist) * speed * dt;
        p.x = Math.max(5, Math.min(CONFIG.MAP_WIDTH - 5, p.x));
        p.y = Math.max(5, Math.min(CONFIG.MAP_HEIGHT - 5, p.y));
    }
    
    // 공격
    if (dist <= spec.range && p.attackCooldown <= 0) {
        const damage = spec.damage * (1 + (p.weaponLevel - 1) * 0.1);
        const armor = WEAPON_SPECS[target.weaponType].armor;
        target.hp -= damage * (1 - armor);
        p.attackCooldown = 1 / spec.attackSpeed;
        
        if (target.hp <= 0) {
            killPlayer(target, p);
        }
    }
}

function tryAttack(p) {
    const spec = WEAPON_SPECS[p.weaponType];
    const enemies = game.players.filter(e => e.team !== p.team && e.alive);
    
    let closest = null;
    let minDist = spec.range;
    
    for (const e of enemies) {
        const d = distance(p, e);
        if (d < minDist) {
            minDist = d;
            closest = e;
        }
    }
    
    if (closest) {
        const damage = spec.damage * (1 + (p.weaponLevel - 1) * 0.1);
        const armor = WEAPON_SPECS[closest.weaponType].armor;
        closest.hp -= damage * (1 - armor);
        p.attackCooldown = 1 / spec.attackSpeed;
        
        if (closest.hp <= 0) {
            killPlayer(closest, p);
        }
    }
}

function killPlayer(victim, killer) {
    victim.alive = false;
    victim.respawnTimer = CONFIG.RESPAWN_TIME;
    
    // XP 보상
    if (killer) {
        game.teams[killer.team].xp += 30;
        checkLevelUp(killer.team);
    }
}

function respawn(p) {
    const baseId = p.team === 0 ? 'A_Base' : 'B_Base';
    const base = game.nodes[baseId];
    p.x = base.x + (Math.random() - 0.5) * 10;
    p.y = base.y + (p.team === 0 ? -10 : 10) + (Math.random() - 0.5) * 10;
    p.hp = p.maxHp;
    p.alive = true;
    p.stunTimer = 0;
    p.channeling = false;
    p.recalling = false;
}

function checkLevelUp(teamId) {
    const team = game.teams[teamId];
    while (team.xp >= CONFIG.XP_PER_LEVEL && team.level < 10) {
        team.xp -= CONFIG.XP_PER_LEVEL;
        team.level++;
        // 무기 포인트 지급
        for (const p of game.players) {
            if (p.team === teamId) {
                p.weaponPoints++;
            }
        }
    }
}

function checkWinCondition() {
    const aGuardian = game.nodes['A_Guardian'];
    const bGuardian = game.nodes['B_Guardian'];
    
    if (aGuardian.owner === 1) {
        game.winner = 1;
    } else if (bGuardian.owner === 0) {
        game.winner = 0;
    }
}

function isAtBase(p) {
    const baseId = p.team === 0 ? 'A_Base' : 'B_Base';
    const base = game.nodes[baseId];
    return distance(p, base) < NODE_SPECS['Base'].radius + 5;
}

function distance(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// ==================== 상태 전송 ====================
function broadcastState() {
    if (!game) return;
    
    const state = {
        tick: game.tick,
        time: game.time,
        players: game.players.map(p => ({
            id: p.id,
            x: Math.round(p.x * 10) / 10,
            y: Math.round(p.y * 10) / 10,
            hp: Math.round(p.hp),
            maxHp: p.maxHp,
            alive: p.alive,
            team: p.team,
            weaponType: p.weaponType,
            weaponLevel: p.weaponLevel,
            stunTimer: p.stunTimer > 0 ? 1 : 0,
            channeling: p.channeling,
            recalling: p.recalling,
            respawnTimer: Math.round(p.respawnTimer * 10) / 10,
            isAI: p.isAI,
        })),
        nodes: {},
        teams: game.teams,
        winner: game.winner,
    };
    
    for (const [id, node] of Object.entries(game.nodes)) {
        state.nodes[id] = {
            x: node.x,
            y: node.y,
            tier: node.type,  // type을 tier로 전송
            owner: node.owner,
            hp: Math.round(node.hp),
            maxHp: node.maxHp,
            locked: false,
        };
    }
    
    io.emit('game_state', state);
}

// ==================== 소켓 이벤트 ====================
io.on('connection', (socket) => {
    console.log('플레이어 접속:', socket.id);
    
    socket.on('join_lobby', (data) => {
        if (gameStarted) {
            socket.emit('error', { message: '게임 진행 중' });
            return;
        }
        
        const player = {
            id: socket.id,
            name: data.name || `Player ${lobbyPlayers.length + 1}`,
            team: lobbyPlayers.length % 2,
            isHost: lobbyPlayers.length === 0
        };
        lobbyPlayers.push(player);
        
        const hostId = lobbyPlayers.length > 0 ? lobbyPlayers[0].id : null;
        io.emit('lobby_update', { players: lobbyPlayers, hostId });
        console.log('로비:', lobbyPlayers.map(p => p.name));
    });
    
    socket.on('change_team', (team) => {
        const player = lobbyPlayers.find(p => p.id === socket.id);
        if (player) {
            player.team = team;
            const hostId = lobbyPlayers.length > 0 ? lobbyPlayers[0].id : null;
            io.emit('lobby_update', { players: lobbyPlayers, hostId });
        }
    });
    
    socket.on('start_game', () => {
        if (gameStarted) return;
        
        gameStarted = true;
        initGame();
        
        io.emit('game_start', { players: lobbyPlayers });
        console.log('게임 시작!');
        
        // 게임 루프 시작 (60fps)
        gameInterval = setInterval(() => {
            update(1 / CONFIG.TPS);
            broadcastState();
        }, 1000 / CONFIG.TPS);
    });
    
    socket.on('player_input', (input) => {
        if (!game) return;
        
        const player = game.players.find(p => p.odI === socket.id);
        if (player && !player.isAI) {
            player.input = input;
        }
    });
    
    socket.on('disconnect', () => {
        console.log('플레이어 퇴장:', socket.id);
        lobbyPlayers = lobbyPlayers.filter(p => p.id !== socket.id);
        
        if (!gameStarted) {
            const hostId = lobbyPlayers.length > 0 ? lobbyPlayers[0].id : null;
            io.emit('lobby_update', { players: lobbyPlayers, hostId });
        }
        
        // 모두 나가면 게임 리셋
        if (lobbyPlayers.length === 0 && gameStarted) {
            clearInterval(gameInterval);
            gameStarted = false;
            game = null;
            console.log('게임 리셋');
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log('PDA 중앙 서버 시작! 포트:', PORT);
});
