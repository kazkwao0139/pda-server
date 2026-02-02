// PDA 중앙 권위 서버 - 싱글플레이어 로직 기반
const http = require('http').createServer((req, res) => {
    res.writeHead(200);
    res.end('PDA Server Running');
});

const io = require('socket.io')(http, {
    cors: { origin: "*" }
});

// ==================== CONFIG ====================
const CONFIG = {
    MAP_WIDTH: 210,
    MAP_HEIGHT: 210,
    TPS: 60,
    PLAYER_RADIUS: 0.5,
    ATTACK_RANGE: 10,
    ATTACK_DAMAGE: 10,
    ATTACK_COOLDOWN: 0.5,
    LANE_WIDTH: 15,
    CHANNEL_RANGE: 1,
    CHANNEL_FAIL_DELAY: 2,
    SHIELD_BASE: 40,
    SHIELD_PER_LEVEL: 10,
    KILL_XP: 4,
    XP_PER_LEVEL: 12,
    MAX_LEVEL: 5,
    BASE_SPEED: 3,
    VISION_RANGE: 18,
    RECALL_TIME: 4,
    BASE_HEAL_RATE: 20,
};

const WEAPON_SPECS = {
    'melee': {
        speedMult: 1.8, range: 3, dpsMult: 0.85, shieldMult: 0.8, armor: 0.2,
        dashDist: 4, dashCool: 3, ultRadius: 8, ultDamage: 40, ultCool: 20,
    },
    'ranged': {
        speedMult: 1.4, range: 14, dpsMult: 0.8, shieldMult: 1.2, armor: 0.1,
        dashDist: 7, dashCool: 8, ultRadius: 6, ultDamage: 35, ultCool: 25,
    },
};

const ULT_REQUIRED_LEVEL = 2;
const ULT_INITIAL_COOL = 10;

const NODE_POSITIONS = {
    'A_Base': { x: 105, y: 200, tier: 'Base', team: 0, initOwner: 0, initLocked: true },
    'A_Guardian': { x: 105, y: 185, tier: 'Guardian', team: 0, initOwner: 0, initLocked: true },
    'A_T3': { x: 105, y: 165, tier: 'T3', team: 0, initOwner: -1, initLocked: true },
    'A_T2_L': { x: 50, y: 140, tier: 'T2', team: 0, initOwner: -1, initLocked: true },
    'A_T2_R': { x: 160, y: 140, tier: 'T2', team: 0, initOwner: -1, initLocked: true },
    'T1_L': { x: 35, y: 105, tier: 'T1', team: -1, initOwner: -1, initLocked: false },
    'T1_R': { x: 175, y: 105, tier: 'T1', team: -1, initOwner: -1, initLocked: false },
    'Breaker': { x: 105, y: 105, tier: 'Breaker', team: -1, initOwner: -1, initLocked: true },
    'B_T2_L': { x: 50, y: 70, tier: 'T2', team: 1, initOwner: -1, initLocked: true },
    'B_T2_R': { x: 160, y: 70, tier: 'T2', team: 1, initOwner: -1, initLocked: true },
    'B_T3': { x: 105, y: 45, tier: 'T3', team: 1, initOwner: -1, initLocked: true },
    'B_Guardian': { x: 105, y: 25, tier: 'Guardian', team: 1, initOwner: 1, initLocked: true },
    'B_Base': { x: 105, y: 10, tier: 'Base', team: 1, initOwner: 1, initLocked: true },
};

const NODE_CONNECTIONS = [
    ['A_Base', 'A_Guardian'], ['A_Guardian', 'A_T3'],
    ['A_T3', 'A_T2_L'], ['A_T3', 'A_T2_R'], ['A_T3', 'Breaker'],
    ['A_T2_L', 'T1_L'], ['A_T2_R', 'T1_R'],
    ['T1_L', 'B_T2_L'], ['T1_R', 'B_T2_R'],
    ['B_T2_L', 'B_T3'], ['B_T2_R', 'B_T3'], ['Breaker', 'B_T3'],
    ['B_T3', 'B_Guardian'], ['B_Guardian', 'B_Base'],
    ['T1_L', 'Breaker'], ['T1_R', 'Breaker'],
    ['A_T2_L', 'Breaker'], ['A_T2_R', 'Breaker'],
    ['B_T2_L', 'Breaker'], ['B_T2_R', 'Breaker'],
];

const NODE_GRAPH = {};
for (const [a, b] of NODE_CONNECTIONS) {
    if (!NODE_GRAPH[a]) NODE_GRAPH[a] = [];
    if (!NODE_GRAPH[b]) NODE_GRAPH[b] = [];
    if (!NODE_GRAPH[a].includes(b)) NODE_GRAPH[a].push(b);
    if (!NODE_GRAPH[b].includes(a)) NODE_GRAPH[b].push(a);
}

const NODE_SPECS = {
    'Base': { radius: 8, hp: 9999, channelTime: 999, dps: 0, range: 0, value: 0 },
    'Guardian': { radius: 6, hp: 500, channelTime: 9.0, dps: 4.0, range: 10, value: 10 },
    'T3': { radius: 5, hp: 400, channelTime: 9.1, dps: 6.0, range: 14, value: 5 },
    'T2': { radius: 7, hp: 300, channelTime: 6.2, dps: 2.5, range: 8, value: 3 },
    'T1': { radius: 7, hp: 200, channelTime: 3.0, dps: 1.5, range: 5, value: 2 },
    'Breaker': { radius: 5, hp: 0, channelTime: 8.4, dps: 0, range: 0, value: 0 },
};

// ==================== GAME STATE ====================
let lobbyPlayers = [];
let gameStarted = false;
let game = null;
let gameInterval = null;

// ==================== UTILITY ====================
function distance(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function getTeamLevel(teamId) {
    return game ? game.teams[teamId].level : 1;
}

function getShieldAtLevel(level) {
    return CONFIG.SHIELD_BASE + CONFIG.SHIELD_PER_LEVEL * level;
}

function getWeaponLevelMult(weaponLevel) {
    return 1 + (weaponLevel - 1) * 0.15;
}

function getPlayerSpeed(p) {
    return CONFIG.BASE_SPEED * WEAPON_SPECS[p.weaponType].speedMult;
}

function getPlayerRange(p) {
    return WEAPON_SPECS[p.weaponType].range;
}

function getPlayerDamage(p) {
    const weaponMult = getWeaponLevelMult(p.weaponLevel);
    return CONFIG.ATTACK_DAMAGE * WEAPON_SPECS[p.weaponType].dpsMult * weaponMult;
}

function isAtBase(p) {
    const baseId = p.team === 0 ? 'A_Base' : 'B_Base';
    const base = game.nodes[baseId];
    return distance(p, base) < 20;
}

// ==================== INIT GAME ====================
function initGame() {
    game = {
        tick: 0,
        time: 0,
        players: [],
        nodes: {},
        teams: [{ xp: 0, level: 1 }, { xp: 0, level: 1 }],
        winner: null,
        aGuardianUnlocked: false,
        bGuardianUnlocked: false,
        breakerSpawned: false,
        breakerClaimCount: 0,
    };
    
    // 노드 초기화
    for (const [id, data] of Object.entries(NODE_POSITIONS)) {
        game.nodes[id] = {
            id,
            x: data.x,
            y: data.y,
            tier: data.tier,
            team: data.team,
            owner: data.initOwner,
            locked: data.initLocked,
            hp: NODE_SPECS[data.tier].hp,
            maxHp: NODE_SPECS[data.tier].hp,
        };
    }
    
    // 인간 플레이어 매칭
    const blueHumans = lobbyPlayers.filter(p => p.team === 0);
    const redHumans = lobbyPlayers.filter(p => p.team === 1);
    
    // 팀 A (0-3)
    for (let i = 0; i < 4; i++) {
        const human = blueHumans[i];
        game.players.push({
            id: i,
            odI: human ? human.id : null,
            team: 0,
            x: 102 + (i % 2) * 6,
            y: 195 - Math.floor(i / 2) * 3,
            hp: 100,
            maxHp: 100,
            isAI: !human,
            level: 1,
            attackCooldown: 0,
            respawnTimer: 0,
            alive: true,
            weaponType: i === 0 ? 'melee' : (i % 2 === 0 ? 'melee' : 'ranged'),
            weaponLevel: 1,
            weaponPoints: 0,
            dashCooldown: 0,
            ultCooldown: ULT_INITIAL_COOL,
            recalling: false,
            recallProgress: 0,
            channeling: false,
            channelTarget: null,
            channelProgress: 0,
            stunTimer: 0,
            input: {},
            currentNode: 'A_Guardian',
        });
    }
    
    // 팀 B (4-7)
    for (let i = 0; i < 4; i++) {
        const human = redHumans[i];
        game.players.push({
            id: i + 4,
            odI: human ? human.id : null,
            team: 1,
            x: 102 + (i % 2) * 6,
            y: 15 + Math.floor(i / 2) * 3,
            hp: 100,
            maxHp: 100,
            isAI: !human,
            level: 1,
            attackCooldown: 0,
            respawnTimer: 0,
            alive: true,
            weaponType: i % 2 === 0 ? 'melee' : 'ranged',
            weaponLevel: 1,
            weaponPoints: 0,
            dashCooldown: 0,
            ultCooldown: ULT_INITIAL_COOL,
            recalling: false,
            recallProgress: 0,
            channeling: false,
            channelTarget: null,
            channelProgress: 0,
            stunTimer: 0,
            input: {},
            currentNode: 'B_Guardian',
        });
    }
    
    console.log('게임 초기화 완료! 플레이어:', game.players.length);
}

// ==================== UPDATE ====================
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
        
        // 스턴 중
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
    
    // 타워 공격
    updateTowerAttacks(dt);
    
    // 노드 잠금 상태 업데이트
    updateNodeLocks();
    
    // 승리 조건
    checkWinCondition();
}

function updatePlayer(p, dt) {
    const input = p.input || {};
    
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
            p.recallProgress = 0;
        } else {
            p.recallProgress += dt;
            if (p.recallProgress >= CONFIG.RECALL_TIME) {
                const baseId = p.team === 0 ? 'A_Base' : 'B_Base';
                const base = game.nodes[baseId];
                p.x = base.x;
                p.y = base.y + (p.team === 0 ? -10 : 10);
                p.hp = p.maxHp;
                p.recalling = false;
                p.recallProgress = 0;
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
        const speed = getPlayerSpeed(p);
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
    // 베이스 힐
    if (isAtBase(p) && p.hp < p.maxHp) {
        p.hp = Math.min(p.maxHp, p.hp + CONFIG.BASE_HEAL_RATE * dt);
        if (p.hp < p.maxHp * 0.8) return; // 80% 회복까지 대기
    }
    
    // HP 낮으면 귀환
    if (p.hp < p.maxHp * 0.3 && !isAtBase(p)) {
        const baseId = p.team === 0 ? 'A_Base' : 'B_Base';
        const base = game.nodes[baseId];
        moveToward(p, base.x, base.y, dt);
        return;
    }
    
    // 채널링 중이면 계속
    if (p.channeling) {
        const node = game.nodes[p.channelTarget];
        if (!node || node.owner === p.team || node.locked) {
            cancelChanneling(p);
        } else {
            // 채널링 진행
            p.channelProgress += dt / NODE_SPECS[node.tier].channelTime;
            if (p.channelProgress >= 1) {
                completeChanneling(p);
            }
        }
        return;
    }
    
    // 적 탐지 (사거리 내)
    const spec = WEAPON_SPECS[p.weaponType];
    const enemies = game.players.filter(e => e.team !== p.team && e.alive);
    let nearestEnemy = null;
    let enemyDist = Infinity;
    
    for (const e of enemies) {
        const d = distance(p, e);
        if (d < enemyDist) {
            enemyDist = d;
            nearestEnemy = e;
        }
    }
    
    // 적이 가까우면 공격
    if (nearestEnemy && enemyDist < 25) {
        // 사거리 밖이면 접근
        if (enemyDist > spec.range * 0.9) {
            moveToward(p, nearestEnemy.x, nearestEnemy.y, dt);
        }
        
        // 공격
        if (enemyDist <= spec.range && p.attackCooldown <= 0) {
            const damage = getPlayerDamage(p);
            const armor = WEAPON_SPECS[nearestEnemy.weaponType].armor;
            nearestEnemy.hp -= damage * (1 - armor);
            p.attackCooldown = CONFIG.ATTACK_COOLDOWN;
            
            if (nearestEnemy.hp <= 0) {
                killPlayer(nearestEnemy, p);
            }
        }
        return;
    }
    
    // 목표 노드 선택 (라인 할당)
    const targetNode = selectTargetNode(p);
    if (!targetNode) return;
    
    const node = game.nodes[targetNode];
    const distToNode = distance(p, node);
    
    // 노드 근처면 채널링 시작
    if (distToNode < CONFIG.CHANNEL_RANGE + 3) {
        if (canAttackNode(node, p.team)) {
            startChanneling(p, targetNode);
        }
        return;
    }
    
    // 노드로 이동
    moveToward(p, node.x, node.y, dt);
}

function moveToward(p, tx, ty, dt) {
    const dx = tx - p.x;
    const dy = ty - p.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return;
    
    const speed = getPlayerSpeed(p);
    p.x += (dx / dist) * speed * dt;
    p.y += (dy / dist) * speed * dt;
    p.x = Math.max(5, Math.min(CONFIG.MAP_WIDTH - 5, p.x));
    p.y = Math.max(5, Math.min(CONFIG.MAP_HEIGHT - 5, p.y));
}

function selectTargetNode(p) {
    // 라인 할당: 짝수 id = 왼쪽, 홀수 id = 오른쪽
    const isLeftLane = p.id % 2 === 0;
    
    const laneNodes = p.team === 0 
        ? (isLeftLane 
            ? ['T1_L', 'A_T2_L', 'B_T2_L', 'B_T3', 'B_Guardian']
            : ['T1_R', 'A_T2_R', 'B_T2_R', 'B_T3', 'B_Guardian'])
        : (isLeftLane 
            ? ['T1_L', 'B_T2_L', 'A_T2_L', 'A_T3', 'A_Guardian']
            : ['T1_R', 'B_T2_R', 'A_T2_R', 'A_T3', 'A_Guardian']);
    
    // 공격 가능한 첫 번째 노드
    for (const nodeId of laneNodes) {
        const node = game.nodes[nodeId];
        if (canAttackNode(node, p.team)) {
            return nodeId;
        }
    }
    
    // 없으면 가디언 방어
    const guardianId = p.team === 0 ? 'A_Guardian' : 'B_Guardian';
    return guardianId;
}

function canAttackNode(node, teamId) {
    if (!node) return false;
    if (node.locked) return false;
    if (node.owner === teamId) return false;
    if (node.tier === 'Base') return false;
    if (node.tier === 'Breaker' && node.owner !== -1) return false;
    return true;
}

function startChanneling(p, nodeId) {
    const node = game.nodes[nodeId];
    p.channeling = true;
    p.channelTarget = nodeId;
    p.channelProgress = 0;
}

function cancelChanneling(p) {
    p.channeling = false;
    p.channelTarget = null;
    p.channelProgress = 0;
}

function completeChanneling(p) {
    const nodeId = p.channelTarget;
    const node = game.nodes[nodeId];
    
    if (node) {
        node.owner = p.team;
        console.log(`노드 ${nodeId} 점령! 팀 ${p.team}`);
        
        // XP 보상
        game.teams[p.team].xp += NODE_SPECS[node.tier].value;
        checkLevelUp(p.team);
    }
    
    cancelChanneling(p);
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
        const damage = getPlayerDamage(p);
        const armor = WEAPON_SPECS[closest.weaponType].armor;
        closest.hp -= damage * (1 - armor);
        p.attackCooldown = CONFIG.ATTACK_COOLDOWN;
        
        if (closest.hp <= 0) {
            killPlayer(closest, p);
        }
    }
}

function killPlayer(victim, killer) {
    victim.alive = false;
    victim.hp = 0;
    const targetTeamLevel = getTeamLevel(victim.team);
    victim.respawnTimer = 6 + 2 * targetTeamLevel;
    
    // XP
    if (killer) {
        game.teams[killer.team].xp += CONFIG.KILL_XP;
        checkLevelUp(killer.team);
    }
}

function respawn(p) {
    const baseId = p.team === 0 ? 'A_Base' : 'B_Base';
    const base = game.nodes[baseId];
    p.x = base.x + (Math.random() - 0.5) * 10;
    p.y = base.y + (p.team === 0 ? -10 : 10);
    p.hp = p.maxHp;
    p.alive = true;
    p.stunTimer = 0;
    p.channeling = false;
    p.recalling = false;
}

function checkLevelUp(teamId) {
    const team = game.teams[teamId];
    while (team.xp >= CONFIG.XP_PER_LEVEL && team.level < CONFIG.MAX_LEVEL) {
        team.xp -= CONFIG.XP_PER_LEVEL;
        team.level++;
        for (const p of game.players) {
            if (p.team === teamId) {
                p.weaponPoints++;
            }
        }
    }
}

function updateTowerAttacks(dt) {
    for (const [id, node] of Object.entries(game.nodes)) {
        const spec = NODE_SPECS[node.tier];
        if (spec.dps <= 0 || spec.range <= 0) continue;
        if (node.owner === -1) continue;
        
        const enemyTeam = 1 - node.owner;
        const enemiesInRange = [];
        
        for (const p of game.players) {
            if (p.team !== enemyTeam || !p.alive) continue;
            if (distance(p, node) < spec.range) {
                enemiesInRange.push(p);
            }
        }
        
        if (enemiesInRange.length === 0) continue;
        
        const dpsPerTarget = spec.dps / enemiesInRange.length;
        
        for (const p of enemiesInRange) {
            if (p.channeling) continue;
            const damage = dpsPerTarget * dt;
            p.hp -= damage;
            
            if (p.hp <= 0) {
                p.alive = false;
                p.hp = 0;
                const targetTeamLevel = getTeamLevel(p.team);
                p.respawnTimer = 6 + 2 * targetTeamLevel;
            }
        }
    }
}

function updateNodeLocks() {
    if (game.nodes['T1_L'].owner !== -1) {
        game.nodes['A_T2_L'].locked = false;
        game.nodes['B_T2_L'].locked = false;
    }
    if (game.nodes['T1_R'].owner !== -1) {
        game.nodes['A_T2_R'].locked = false;
        game.nodes['B_T2_R'].locked = false;
    }
    if (game.nodes['A_T2_L'].owner !== -1 || game.nodes['A_T2_R'].owner !== -1) {
        game.nodes['A_T3'].locked = false;
    }
    if (game.nodes['B_T2_L'].owner !== -1 || game.nodes['B_T2_R'].owner !== -1) {
        game.nodes['B_T3'].locked = false;
    }
    if (game.nodes['A_T3'].owner === 1) {
        game.aGuardianUnlocked = true;
    }
    if (game.nodes['B_T3'].owner === 0) {
        game.bGuardianUnlocked = true;
    }
    if (game.aGuardianUnlocked) {
        game.nodes['A_Guardian'].locked = false;
    }
    if (game.bGuardianUnlocked) {
        game.nodes['B_Guardian'].locked = false;
    }
}

function checkWinCondition() {
    if (game.nodes['A_Guardian'].owner === 1) {
        game.winner = 1;
        console.log('🔴 레드팀 승리!');
    } else if (game.nodes['B_Guardian'].owner === 0) {
        game.winner = 0;
        console.log('🔵 블루팀 승리!');
    }
}

// ==================== BROADCAST STATE ====================
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
            weaponPoints: p.weaponPoints,
            dashCooldown: Math.round(p.dashCooldown * 10) / 10,
            ultCooldown: Math.round(p.ultCooldown * 10) / 10,
            attackCooldown: p.attackCooldown,
            stunTimer: p.stunTimer > 0 ? p.stunTimer : 0,
            channeling: p.channeling,
            recalling: p.recalling,
            recallProgress: p.recallProgress || 0,
            respawnTimer: Math.round(p.respawnTimer * 10) / 10,
            isAI: p.isAI,
        })),
        nodes: {},
        teams: game.teams,
        winner: game.winner,
        breakerSpawned: game.breakerSpawned,
        breakerClaimCount: game.breakerClaimCount,
    };
    
    for (const [id, node] of Object.entries(game.nodes)) {
        state.nodes[id] = {
            id,
            x: node.x,
            y: node.y,
            tier: node.tier,
            owner: node.owner,
            locked: node.locked,
            hp: Math.round(node.hp),
            maxHp: node.maxHp,
        };
    }
    
    io.emit('game_state', state);
}

// ==================== SOCKET EVENTS ====================
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
        
        const hostId = lobbyPlayers[0].id;
        io.emit('lobby_update', { players: lobbyPlayers, hostId });
        console.log('로비:', lobbyPlayers.map(p => p.name));
    });
    
    socket.on('change_team', (team) => {
        const player = lobbyPlayers.find(p => p.id === socket.id);
        if (player) {
            player.team = team;
            const hostId = lobbyPlayers[0].id;
            io.emit('lobby_update', { players: lobbyPlayers, hostId });
        }
    });
    
    socket.on('start_game', () => {
        if (gameStarted) return;
        
        gameStarted = true;
        initGame();
        
        io.emit('game_start', { players: lobbyPlayers });
        console.log('게임 시작!');
        
        // 게임 루프 (60fps 시뮬, 30fps 전송)
        let tickCount = 0;
        gameInterval = setInterval(() => {
            update(1 / CONFIG.TPS);
            tickCount++;
            if (tickCount % 2 === 0) {  // 30fps 전송
                broadcastState();
            }
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
        
        if (!gameStarted && lobbyPlayers.length > 0) {
            const hostId = lobbyPlayers[0].id;
            io.emit('lobby_update', { players: lobbyPlayers, hostId });
        }
        
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
