// PDA 중앙 권위 서버 - 싱글플레이어 로직 기반
console.log('=== 서버 시작 중... ===');

const http = require('http').createServer((req, res) => {
    res.writeHead(200);
    res.end('PDA Server Running');
});

console.log('=== HTTP 서버 생성 완료 ===');

const io = require('socket.io')(http, {
    cors: { origin: "*" }
});

console.log('=== Socket.IO 초기화 완료 ===');

// ==================== CONFIG ====================
const CONFIG = {
    MAP_WIDTH: 210,
    MAP_HEIGHT: 210,
    TPS: 60,
    PLAYER_RADIUS: 0.5,
    PLAYER_SPEED: 8,
    ATTACK_RANGE: 10,
    ATTACK_DAMAGE: 10,
    ATTACK_COOLDOWN: 0.5,
    LANE_WIDTH: 15,
    CHANNEL_RANGE: 1,
    AI_NODE_DETECT_RANGE: 3,
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

// 부쉬 위치
const BUSHES = [
    { x: 25, y: 105, radius: 6 },
    { x: 185, y: 105, radius: 6 },
    { x: 40, y: 130, radius: 5 },
    { x: 170, y: 130, radius: 5 },
    { x: 40, y: 80, radius: 5 },
    { x: 170, y: 80, radius: 5 },
    { x: 95, y: 155, radius: 5 },
    { x: 115, y: 155, radius: 5 },
    { x: 95, y: 55, radius: 5 },
    { x: 115, y: 55, radius: 5 },
    { x: 95, y: 115, radius: 5 },
    { x: 115, y: 95, radius: 5 },
];

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

// 점과 선분 사이 최단 거리
function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSq = dx * dx + dy * dy;
    
    if (lengthSq === 0) {
        return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
    }
    
    let t = ((px - x1) * dx + (py - y1) * dy) / lengthSq;
    t = Math.max(0, Math.min(1, t));
    
    const nearestX = x1 + t * dx;
    const nearestY = y1 + t * dy;
    
    return Math.sqrt((px - nearestX) ** 2 + (py - nearestY) ** 2);
}

// 플레이어가 도로 위에 있는지 확인
function isOnRoad(x, y) {
    const halfWidth = CONFIG.LANE_WIDTH / 2;
    
    for (const [from, to] of NODE_CONNECTIONS) {
        const n1 = NODE_POSITIONS[from];
        const n2 = NODE_POSITIONS[to];
        const dist = pointToSegmentDistance(x, y, n1.x, n1.y, n2.x, n2.y);
        if (dist <= halfWidth) {
            return true;
        }
    }
    return false;
}

// 가장 가까운 도로 위 위치 찾기
function getNearestRoadPosition(x, y) {
    const halfWidth = CONFIG.LANE_WIDTH / 2;
    let bestX = x, bestY = y;
    let minDist = Infinity;
    
    for (const [from, to] of NODE_CONNECTIONS) {
        const n1 = NODE_POSITIONS[from];
        const n2 = NODE_POSITIONS[to];
        
        const dx = n2.x - n1.x;
        const dy = n2.y - n1.y;
        const lengthSq = dx * dx + dy * dy;
        
        if (lengthSq === 0) continue;
        
        let t = ((x - n1.x) * dx + (y - n1.y) * dy) / lengthSq;
        t = Math.max(0, Math.min(1, t));
        
        const nearestX = n1.x + t * dx;
        const nearestY = n1.y + t * dy;
        const dist = Math.sqrt((x - nearestX) ** 2 + (y - nearestY) ** 2);
        
        if (dist < minDist) {
            minDist = dist;
            if (dist > 0) {
                const ratio = (halfWidth - 0.5) / dist;
                bestX = nearestX + (x - nearestX) * ratio;
                bestY = nearestY + (y - nearestY) * ratio;
            } else {
                bestX = nearestX;
                bestY = nearestY;
            }
        }
    }
    return { x: bestX, y: bestY };
}

// 채널링 보호막
function getChannelShield(p) {
    const teamLevel = getTeamLevel(p.team);
    const baseShield = getShieldAtLevel(teamLevel);
    const weaponMult = getWeaponLevelMult(p.weaponLevel);
    return baseShield * WEAPON_SPECS[p.weaponType].shieldMult * weaponMult;
}

// 부쉬 안에 있는지 확인
function isInBush(p) {
    for (const bush of BUSHES) {
        if (distance(p, bush) < bush.radius) {
            return true;
        }
    }
    return false;
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
        // 브레이커 시스템
        gHistory: [],
        breakerSpawned: false,
        breakerClaimCount: 0,
        firstStalemateTime: -1,
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
            // 채널링 상태
            channeling: false,
            channelTarget: null,
            channelProgress: 0,
            channelTime: 0,
            channelShield: 0,
            maxChannelShield: 0,
            channelCompleted: false,
            stunTimer: 0,
            hasBreakerbuff: false,
            targetNode: null,
            currentNode: 'A_Guardian',
            input: {},
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
            // 채널링 상태
            channeling: false,
            channelTarget: null,
            channelProgress: 0,
            channelTime: 0,
            channelShield: 0,
            maxChannelShield: 0,
            channelCompleted: false,
            stunTimer: 0,
            hasBreakerbuff: false,
            targetNode: null,
            currentNode: 'B_Guardian',
            input: {},
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
    
    // AI 다중 채널링 처리
    updateMultiChanneling(dt);
    
    // 노드 잠금 상태 업데이트
    updateNodeLocks();
    
    // 브레이커 시스템 (매 초마다 G값 기록)
    if (Math.floor(game.time) > game.gHistory.length) {
        game.gHistory.push(calculateG());
        // 최대 900개 (15분)
        if (game.gHistory.length > 900) {
            game.gHistory.shift();
        }
        spawnBreakerIfNeeded();
    }
    
    // 승리 조건
    checkWinCondition();
}

function updatePlayer(p, dt) {
    const input = p.input || {};
    
    // 스턴 중이면 아무것도 못함
    if (p.stunTimer > 0) {
        p.stunTimer -= dt;
        return;
    }
    
    // 무기 교체 (베이스에서만)
    if (isAtBase(p)) {
        if (input['1']) p.weaponType = 'melee';
        if (input['2']) p.weaponType = 'ranged';
        
        // 베이스 근처 HP 회복
        if (p.hp < p.maxHp) {
            p.hp = Math.min(p.maxHp, p.hp + CONFIG.BASE_HEAL_RATE * dt);
        }
    }
    
    // 무기 레벨 투자 (3키)
    if (input['3'] && p.weaponPoints > 0) {
        p.weaponLevel++;
        p.weaponPoints--;
        p.input['3'] = false;
    }
    
    // B키 누르면 귀환
    if (input.b && !isAtBase(p) && !p.channeling && !p.recalling) {
        p.recalling = true;
        p.recallProgress = 0;
    }
    
    // 귀환 중이면
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
    
    // F키 누르면 채널링 시도
    if (input.f && !p.channeling && !p.channelCompleted) {
        tryStartChanneling(p);
    }
    
    // F키 떼면 channelCompleted 리셋
    if (!input.f) {
        p.channelCompleted = false;
    }
    
    // 채널링 중이면
    if (p.channeling) {
        if (!input.f) {
            failChanneling(p);
        } else {
            p.channelProgress += dt;
            if (p.channelProgress >= p.channelTime) {
                completeChanneling(p);
                p.channelCompleted = true;
            }
        }
        return;
    }
    
    // E키 대시
    if (input.e && p.dashCooldown <= 0) {
        const spec = WEAPON_SPECS[p.weaponType];
        // 마우스 방향으로 대시
        const mouseWorldX = input.mouseX || p.x;
        const mouseWorldY = input.mouseY || p.y;
        
        let dirX = mouseWorldX - p.x;
        let dirY = mouseWorldY - p.y;
        const len = Math.sqrt(dirX * dirX + dirY * dirY);
        
        if (len > 0) {
            const dx = (dirX / len) * spec.dashDist;
            const dy = (dirY / len) * spec.dashDist;
            
            let dashX = p.x + dx;
            let dashY = p.y + dy;
            
            if (!isOnRoad(dashX, dashY)) {
                const nearest = getNearestRoadPosition(dashX, dashY);
                dashX = nearest.x;
                dashY = nearest.y;
            }
            
            dashX = Math.max(5, Math.min(CONFIG.MAP_WIDTH - 5, dashX));
            dashY = Math.max(5, Math.min(CONFIG.MAP_HEIGHT - 5, dashY));
            
            p.x = dashX;
            p.y = dashY;
            p.dashCooldown = spec.dashCool;
        }
        p.input.e = false;
        return;
    }
    
    // Q키 궁극기
    if (input.q && p.ultCooldown <= 0 && getTeamLevel(p.team) >= ULT_REQUIRED_LEVEL) {
        const spec = WEAPON_SPECS[p.weaponType];
        let ultX, ultY;
        
        if (p.weaponType === 'melee') {
            ultX = p.x;
            ultY = p.y;
        } else {
            ultX = input.mouseX || p.x;
            ultY = input.mouseY || p.y;
        }
        
        // 범위 내 적에게 데미지
        for (const enemy of game.players) {
            if (enemy.team === p.team || !enemy.alive) continue;
            if (distance({x: ultX, y: ultY}, enemy) < spec.ultRadius) {
                const armor = WEAPON_SPECS[enemy.weaponType].armor;
                const finalDamage = spec.ultDamage * (1 - armor);
                enemy.hp -= finalDamage;
                
                if (enemy.recalling) {
                    enemy.recalling = false;
                    enemy.recallProgress = 0;
                }
                if (enemy.channeling) {
                    failChanneling(enemy);
                }
                
                if (enemy.hp <= 0) {
                    enemy.alive = false;
                    enemy.hp = 0;
                    const targetTeamLevel = getTeamLevel(enemy.team);
                    enemy.respawnTimer = 6 + 2 * targetTeamLevel;
                    addTeamXP(p.team, CONFIG.KILL_XP);
                }
            }
        }
        
        p.ultCooldown = spec.ultCool;
        p.input.q = false;
        return;
    }
    
    // 이동
    let vx = 0, vy = 0;
    if (input.w) vy -= 1;
    if (input.s) vy += 1;
    if (input.a) vx -= 1;
    if (input.d) vx += 1;
    
    const speed = getPlayerSpeed(p);
    
    if (vx !== 0 || vy !== 0) {
        const len = Math.sqrt(vx * vx + vy * vy);
        vx = (vx / len) * speed;
        vy = (vy / len) * speed;
    }
    
    const newX = p.x + vx * dt;
    const newY = p.y + vy * dt;
    
    // 도로 위인지 확인
    if (isOnRoad(newX, newY)) {
        p.x = newX;
        p.y = newY;
    } else {
        const nearest = getNearestRoadPosition(newX, newY);
        p.x = nearest.x;
        p.y = nearest.y;
    }
    
    // 맵 경계
    p.x = Math.max(5, Math.min(CONFIG.MAP_WIDTH - 5, p.x));
    p.y = Math.max(5, Math.min(CONFIG.MAP_HEIGHT - 5, p.y));
    
    // 공격
    if (input.mouseDown && p.attackCooldown <= 0) {
        tryAttack(p);
    }
}

// 팀 XP 추가
function addTeamXP(teamId, amount) {
    const team = game.teams[teamId];
    team.xp += amount;
    
    while (team.xp >= CONFIG.XP_PER_LEVEL && team.level < CONFIG.MAX_LEVEL) {
        team.xp -= CONFIG.XP_PER_LEVEL;
        team.level++;
        
        for (const p of game.players) {
            if (p.team === teamId) {
                p.weaponPoints++;
            }
        }
    }
    
    if (team.level >= CONFIG.MAX_LEVEL) {
        team.xp = Math.min(team.xp, CONFIG.XP_PER_LEVEL - 1);
    }
}

// ==================== 브레이커 버프 ====================
function getBreakerbuff() {
    const BASE = 0.50;
    const STEP = 0.15;
    const MAX = 0.80;
    const count = game.breakerClaimCount;
    if (count === 0) return 0;
    const buff = BASE + (count - 1) * STEP;
    return Math.min(buff, MAX);
}

// ==================== 시야 ====================
function getPlayerBush(p) {
    for (let i = 0; i < BUSHES.length; i++) {
        const bush = BUSHES[i];
        if (distance(p, bush) < bush.radius) {
            return i;
        }
    }
    return -1;
}

function canSeeTarget(observer, target) {
    if (observer.team === target.team) return true;
    const targetBush = getPlayerBush(target);
    if (targetBush === -1) return true;
    const observerBush = getPlayerBush(observer);
    return observerBush === targetBush;
}

// ==================== 다중 채널링 ====================
function multiChannelFactor(n, A = 4, c = 0.25, k = 5) {
    if (n <= 0) return 1.0;
    return c + (1 - c) * Math.exp(-k * Math.pow(n / A, 2));
}

function updateMultiChanneling(dt) {
    for (const [nodeId, node] of Object.entries(game.nodes)) {
        const team0Channelers = game.players.filter(p => 
            p.team === 0 && p.alive && p.channeling && p.channelTarget === nodeId && p.isAI
        );
        const team1Channelers = game.players.filter(p => 
            p.team === 1 && p.alive && p.channeling && p.channelTarget === nodeId && p.isAI
        );
        
        if (team0Channelers.length > 0) {
            const factor = multiChannelFactor(team0Channelers.length);
            const baseTime = NODE_SPECS[node.tier].channelTime;
            const effectiveTime = baseTime * factor;
            const progressRate = dt / effectiveTime;
            
            for (const p of team0Channelers) {
                if (p.hasBreakerbuff) {
                    p.channelProgress += progressRate / (1 - getBreakerbuff());
                } else {
                    p.channelProgress += progressRate;
                }
                
                if (p.channelProgress >= 1) {
                    completeChanneling(p);
                    break;
                }
            }
        }
        
        if (team1Channelers.length > 0) {
            const factor = multiChannelFactor(team1Channelers.length);
            const baseTime = NODE_SPECS[node.tier].channelTime;
            const effectiveTime = baseTime * factor;
            const progressRate = dt / effectiveTime;
            
            for (const p of team1Channelers) {
                if (p.hasBreakerbuff) {
                    p.channelProgress += progressRate / (1 - getBreakerbuff());
                } else {
                    p.channelProgress += progressRate;
                }
                
                if (p.channelProgress >= 1) {
                    completeChanneling(p);
                    break;
                }
            }
        }
    }
}

// ==================== 노드 경로 ====================
const NODE_ROUTES = {
    'A_Guardian': { 'A_T3': 'A_T3', 'A_T2_L': 'A_T3', 'A_T2_R': 'A_T3', 'T1_L': 'A_T3', 'T1_R': 'A_T3', 'Breaker': 'A_T3', 'B_T2_L': 'A_T3', 'B_T2_R': 'A_T3', 'B_T3': 'A_T3', 'B_Guardian': 'A_T3' },
    'A_T3': { 'A_T2_L': 'A_T2_L', 'A_T2_R': 'A_T2_R', 'T1_L': 'A_T2_L', 'T1_R': 'A_T2_R', 'Breaker': 'Breaker', 'B_T2_L': 'A_T2_L', 'B_T2_R': 'A_T2_R', 'B_T3': 'Breaker', 'B_Guardian': 'Breaker', 'A_Guardian': 'A_Guardian' },
    'A_T2_L': { 'T1_L': 'T1_L', 'Breaker': 'Breaker', 'B_T2_L': 'T1_L', 'B_T3': 'T1_L', 'B_Guardian': 'T1_L', 'A_T3': 'A_T3', 'A_Guardian': 'A_T3', 'T1_R': 'Breaker', 'A_T2_R': 'Breaker', 'B_T2_R': 'Breaker' },
    'A_T2_R': { 'T1_R': 'T1_R', 'Breaker': 'Breaker', 'B_T2_R': 'T1_R', 'B_T3': 'T1_R', 'B_Guardian': 'T1_R', 'A_T3': 'A_T3', 'A_Guardian': 'A_T3', 'T1_L': 'Breaker', 'A_T2_L': 'Breaker', 'B_T2_L': 'Breaker' },
    'T1_L': { 'B_T2_L': 'B_T2_L', 'B_T3': 'B_T2_L', 'B_Guardian': 'B_T2_L', 'Breaker': 'Breaker', 'A_T2_L': 'A_T2_L', 'A_T3': 'A_T2_L', 'A_Guardian': 'A_T2_L', 'T1_R': 'Breaker', 'A_T2_R': 'Breaker', 'B_T2_R': 'Breaker' },
    'T1_R': { 'B_T2_R': 'B_T2_R', 'B_T3': 'B_T2_R', 'B_Guardian': 'B_T2_R', 'Breaker': 'Breaker', 'A_T2_R': 'A_T2_R', 'A_T3': 'A_T2_R', 'A_Guardian': 'A_T2_R', 'T1_L': 'Breaker', 'A_T2_L': 'Breaker', 'B_T2_L': 'Breaker' },
    'Breaker': { 'A_T3': 'A_T3', 'B_T3': 'B_T3', 'A_T2_L': 'A_T2_L', 'A_T2_R': 'A_T2_R', 'B_T2_L': 'B_T2_L', 'B_T2_R': 'B_T2_R', 'T1_L': 'T1_L', 'T1_R': 'T1_R', 'A_Guardian': 'A_T3', 'B_Guardian': 'B_T3' },
    'B_T2_L': { 'B_T3': 'B_T3', 'B_Guardian': 'B_T3', 'T1_L': 'T1_L', 'Breaker': 'Breaker', 'A_T2_L': 'T1_L', 'A_T3': 'T1_L', 'A_Guardian': 'T1_L', 'T1_R': 'Breaker', 'A_T2_R': 'Breaker', 'B_T2_R': 'Breaker' },
    'B_T2_R': { 'B_T3': 'B_T3', 'B_Guardian': 'B_T3', 'T1_R': 'T1_R', 'Breaker': 'Breaker', 'A_T2_R': 'T1_R', 'A_T3': 'T1_R', 'A_Guardian': 'T1_R', 'T1_L': 'Breaker', 'A_T2_L': 'Breaker', 'B_T2_L': 'Breaker' },
    'B_T3': { 'B_T2_L': 'B_T2_L', 'B_T2_R': 'B_T2_R', 'T1_L': 'B_T2_L', 'T1_R': 'B_T2_R', 'Breaker': 'Breaker', 'A_T2_L': 'B_T2_L', 'A_T2_R': 'B_T2_R', 'A_T3': 'Breaker', 'A_Guardian': 'Breaker', 'B_Guardian': 'B_Guardian' },
    'B_Guardian': { 'B_T3': 'B_T3', 'B_T2_L': 'B_T3', 'B_T2_R': 'B_T3', 'T1_L': 'B_T3', 'T1_R': 'B_T3', 'Breaker': 'B_T3', 'A_T2_L': 'B_T3', 'A_T2_R': 'B_T3', 'A_T3': 'B_T3', 'A_Guardian': 'B_T3' },
};

function getNextNode(fromId, toId) {
    if (fromId === toId) return toId;
    return NODE_ROUTES[fromId]?.[toId] || toId;
}

function findCurrentNode(p) {
    let nearest = null, minDist = Infinity;
    for (const [id, node] of Object.entries(game.nodes)) {
        if (id === 'A_Base' || id === 'B_Base') continue;
        const d = distance(p, node);
        if (d < minDist) { minDist = d; nearest = id; }
    }
    return nearest;
}

function moveToNode(p, nodeId, speed, dt) {
    const node = game.nodes[nodeId];
    if (!node) return;
    
    const dx = node.x - p.x;
    const dy = node.y - p.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 3) {
        p.currentNode = nodeId;
        return;
    }
    
    const newX = p.x + (dx / dist) * speed * dt;
    const newY = p.y + (dy / dist) * speed * dt;
    
    if (isOnRoad(newX, newY)) {
        p.x = newX;
        p.y = newY;
    } else {
        const nearest = getNearestRoadPosition(newX, newY);
        p.x = nearest.x;
        p.y = nearest.y;
    }
    
    p.x = Math.max(15, Math.min(CONFIG.MAP_WIDTH - 15, p.x));
    p.y = Math.max(15, Math.min(CONFIG.MAP_HEIGHT - 15, p.y));
}

// ==================== 자유에너지 AI ====================
function feScore(situation, ideal, beta = 2.0) {
    let dist = 0;
    for (const k in ideal) {
        dist += ((situation[k] || 0) - ideal[k]) ** 2;
    }
    return Math.exp(-beta * dist);
}

function feSelect(options) {
    const total = options.reduce((sum, o) => sum + o.score, 0);
    if (total <= 0) return options[0]?.action;
    const r = Math.random() * total;
    let acc = 0;
    for (const o of options) {
        acc += o.score;
        if (r < acc) return o.action;
    }
    return options[0]?.action;
}

function detectSituation(p) {
    const enemies = game.players.filter(e => e.team !== p.team && e.alive);
    const allies = game.players.filter(a => a.team === p.team && a.alive && a.id !== p.id);
    
    let nearestEnemy = null, enemyDist = Infinity;
    for (const e of enemies) {
        if (!canSeeTarget(p, e)) continue;
        const d = distance(p, e);
        if (d < enemyDist) { enemyDist = d; nearestEnemy = e; }
    }
    
    const nearbyAllies = allies.filter(a => distance(p, a) < 25).length;
    const nearbyEnemies = enemies.filter(e => distance(p, e) < 25 && canSeeTarget(p, e)).length;
    
    return {
        hpRatio: p.hp / p.maxHp,
        nearestEnemy,
        enemyDist,
        nearbyAllies,
        nearbyEnemies,
        advantage: (nearbyAllies + 1) / Math.max(nearbyEnemies, 1),
        aliveAllies: allies.length + 1,
    };
}

function feDecideAction(p, sit) {
    const options = [];
    
    if (sit.hpRatio < 0.4) {
        options.push({
            action: 'retreat',
            score: feScore(
                { hp: sit.hpRatio, danger: sit.nearbyEnemies / 3 },
                { hp: 0.15, danger: 0.8 }
            ) * 3
        });
    }
    
    if (sit.hpRatio < 0.4 && sit.enemyDist > 30) {
        options.push({
            action: 'recall',
            score: feScore(
                { hp: sit.hpRatio, safe: sit.enemyDist > 30 ? 1 : 0 },
                { hp: 0.2, safe: 1 }
            ) * 2.5
        });
    }
    
    if (sit.nearestEnemy && sit.enemyDist < 20) {
        options.push({
            action: 'attack',
            score: feScore(
                { hp: sit.hpRatio, advantage: Math.min(sit.advantage, 2) / 2 },
                { hp: 0.5, advantage: 0.7 }
            ) * 2
        });
    }
    
    options.push({
        action: 'channel',
        score: feScore(
            { hp: sit.hpRatio, safe: sit.enemyDist > 15 ? 1 : 0 },
            { hp: 0.4, safe: 0.9 }
        ) * 2
    });
    
    options.push({ action: 'move', score: 1.0 });
    
    return feSelect(options);
}

function feSelectTargetNode(p) {
    const breaker = game.nodes['Breaker'];
    const breakerActive = game.breakerSpawned && breaker?.owner === -1;
    const aliveAllies = game.players.filter(x => x.team === p.team && x.alive).length;
    
    if (breakerActive && aliveAllies >= 3 && canAttackNode(breaker, p.team)) {
        return 'Breaker';
    }
    
    const isLeftLane = p.id % 2 === 0;
    
    const laneNodes = p.team === 0 
        ? (isLeftLane 
            ? ['A_T2_L', 'T1_L', 'B_T2_L', 'B_T3', 'B_Guardian']
            : ['A_T2_R', 'T1_R', 'B_T2_R', 'B_T3', 'B_Guardian'])
        : (isLeftLane 
            ? ['B_T2_L', 'T1_L', 'A_T2_L', 'A_T3', 'A_Guardian']
            : ['B_T2_R', 'T1_R', 'A_T2_R', 'A_T3', 'A_Guardian']);
    
    for (const nodeId of laneNodes) {
        const node = game.nodes[nodeId];
        if (node && canAttackNode(node, p.team)) {
            return nodeId;
        }
    }
    
    const enemyGuardian = p.team === 0 ? 'B_Guardian' : 'A_Guardian';
    if (canAttackNode(game.nodes[enemyGuardian], p.team)) {
        return enemyGuardian;
    }
    
    return isLeftLane ? 'T1_L' : 'T1_R';
}

// ==================== AI 스킬 ====================
function aiDash(p, dirX, dirY) {
    if (p.dashCooldown > 0) return false;
    
    const spec = WEAPON_SPECS[p.weaponType];
    const len = Math.sqrt(dirX * dirX + dirY * dirY);
    if (len === 0) return false;
    
    const dx = (dirX / len) * spec.dashDist;
    const dy = (dirY / len) * spec.dashDist;
    
    let dashX = p.x + dx;
    let dashY = p.y + dy;
    
    if (!isOnRoad(dashX, dashY)) {
        const nearest = getNearestRoadPosition(dashX, dashY);
        dashX = nearest.x;
        dashY = nearest.y;
    }
    
    dashX = Math.max(5, Math.min(CONFIG.MAP_WIDTH - 5, dashX));
    dashY = Math.max(5, Math.min(CONFIG.MAP_HEIGHT - 5, dashY));
    
    p.x = dashX;
    p.y = dashY;
    p.dashCooldown = spec.dashCool;
    
    return true;
}

function aiUseUlt(p) {
    if (p.ultCooldown > 0) return false;
    if (getTeamLevel(p.team) < ULT_REQUIRED_LEVEL) return false;
    
    const spec = WEAPON_SPECS[p.weaponType];
    let ultX, ultY;
    
    const nearbyEnemies = [];
    for (const enemy of game.players) {
        if (enemy.team === p.team || !enemy.alive) continue;
        if (!canSeeTarget(p, enemy)) continue;
        const d = distance(p, enemy);
        if (d < 20) {
            nearbyEnemies.push({ enemy, dist: d });
        }
    }
    
    if (nearbyEnemies.length === 0) return false;
    
    if (p.weaponType === 'melee') {
        const inRange = nearbyEnemies.filter(e => e.dist < spec.ultRadius);
        if (inRange.length === 0) return false;
        ultX = p.x;
        ultY = p.y;
    } else {
        nearbyEnemies.sort((a, b) => a.dist - b.dist);
        const target = nearbyEnemies[0].enemy;
        ultX = target.x;
        ultY = target.y;
    }
    
    for (const enemy of game.players) {
        if (enemy.team === p.team || !enemy.alive) continue;
        if (distance({ x: ultX, y: ultY }, enemy) < spec.ultRadius) {
            const armor = WEAPON_SPECS[enemy.weaponType].armor;
            enemy.hp -= spec.ultDamage * (1 - armor);
            
            if (enemy.recalling) {
                enemy.recalling = false;
                enemy.recallProgress = 0;
            }
            if (enemy.channeling) {
                enemy.channelShield -= spec.ultDamage;
                if (enemy.channelShield <= 0) {
                    failChanneling(enemy);
                }
            }
            
            if (enemy.hp <= 0) {
                enemy.hp = 0;
                enemy.alive = false;
                const targetTeamLevel = getTeamLevel(enemy.team);
                enemy.respawnTimer = 6 + 2 * targetTeamLevel;
                addTeamXP(p.team, CONFIG.KILL_XP);
            }
        }
    }
    
    p.ultCooldown = spec.ultCool;
    return true;
}

function aiDoAttack(p, target, dt) {
    if (!target || !target.alive) return;
    const range = getPlayerRange(p);
    const d = distance(p, target);
    
    if (d > range * 0.9) {
        const dx = target.x - p.x;
        const dy = target.y - p.y;
        const speed = getPlayerSpeed(p);
        p.x += (dx / d) * speed * dt;
        p.y += (dy / d) * speed * dt;
    }
    
    if (d <= range && p.attackCooldown <= 0) {
        attack(p, target);
    }
}

function aiStartChanneling(p, nodeId) {
    const node = game.nodes[nodeId];
    if (!node || !canAttackNode(node, p.team)) return false;
    if (distance(p, node) > CONFIG.CHANNEL_RANGE) return false;
    
    p.channeling = true;
    p.channelTarget = nodeId;
    p.channelProgress = 0;
    p.channelTime = NODE_SPECS[node.tier].channelTime;
    p.channelShield = getChannelShield(p);
    p.maxChannelShield = p.channelShield;
    return true;
}

// ==================== 공격 ====================
function attack(p, target) {
    const damage = getPlayerDamage(p);
    const armor = WEAPON_SPECS[target.weaponType].armor;
    const finalDamage = damage * (1 - armor);
    
    // 채널링 중이면 보호막 먼저
    if (target.channeling && target.channelShield > 0) {
        target.channelShield -= finalDamage;
        if (target.channelShield <= 0) {
            failChanneling(target);
        }
    } else {
        target.hp -= finalDamage;
    }
    
    // 귀환 취소
    if (target.recalling) {
        target.recalling = false;
        target.recallProgress = 0;
    }
    
    p.attackCooldown = CONFIG.ATTACK_COOLDOWN;
    
    if (target.hp <= 0) {
        target.hp = 0;
        target.alive = false;
        const targetTeamLevel = getTeamLevel(target.team);
        target.respawnTimer = 6 + 2 * targetTeamLevel;
        addTeamXP(p.team, CONFIG.KILL_XP);
    }
}

// ==================== 메인 AI ====================
function updateAI(p, dt) {
    const speed = getPlayerSpeed(p);
    
    // AI 무기 레벨 투자
    if (p.weaponPoints > 0) {
        p.weaponLevel++;
        p.weaponPoints--;
    }
    
    // 상태 처리
    if (p.stunTimer > 0) { p.stunTimer -= dt; return; }
    
    if (p.recalling) {
        p.recallProgress += dt;
        if (p.recallProgress >= CONFIG.RECALL_TIME) {
            const base = game.nodes[p.team === 0 ? 'A_Base' : 'B_Base'];
            p.x = base.x; p.y = base.y;
            p.hp = p.maxHp;
            p.recalling = false;
            p.currentNode = p.team === 0 ? 'A_Guardian' : 'B_Guardian';
            p.targetNode = null;
        }
        return;
    }
    
    if (p.channeling) {
        // 채널링 진행은 updateMultiChanneling()에서 처리
        return;
    }
    
    // 베이스 힐
    if (isAtBase(p) && p.hp < p.maxHp) {
        p.hp = Math.min(p.maxHp, p.hp + CONFIG.BASE_HEAL_RATE * dt);
        if (p.hp < p.maxHp * 0.8) return;
    }
    
    // 상황 감지
    const sit = detectSituation(p);
    
    const inCombat = sit.nearestEnemy && sit.enemyDist < 20;
    const lowHP = sit.hpRatio < 0.4;
    
    // 적 없으면 채널링 우선
    if (!inCombat) {
        for (const [id, node] of Object.entries(game.nodes)) {
            if (!canAttackNode(node, p.team)) continue;
            const d = distance(p, node);
            
            if (d < CONFIG.CHANNEL_RANGE) {
                aiStartChanneling(p, id);
                return;
            }
            
            if (d < CONFIG.AI_NODE_DETECT_RANGE) {
                const dx = node.x - p.x;
                const dy = node.y - p.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > 0) {
                    p.x += (dx / dist) * speed * dt;
                    p.y += (dy / dist) * speed * dt;
                }
                return;
            }
        }
    }
    
    if (lowHP || inCombat) {
        const action = feDecideAction(p, sit);
        
        if (action === 'retreat') {
            p.targetNode = null;
            const baseNode = p.team === 0 ? 'A_Guardian' : 'B_Guardian';
            
            if (sit.hpRatio < 0.3 && sit.nearestEnemy && sit.enemyDist < 10) {
                const dx = p.x - sit.nearestEnemy.x;
                const dy = p.y - sit.nearestEnemy.y;
                aiDash(p, dx, dy);
            }
            
            moveToNode(p, baseNode, speed * 1.2, dt);
            if (sit.nearestEnemy && sit.enemyDist <= getPlayerRange(p) && p.attackCooldown <= 0) {
                attack(p, sit.nearestEnemy);
            }
            return;
        }
        
        if (action === 'recall') {
            p.recalling = true;
            p.recallProgress = 0;
            return;
        }
        
        if (action === 'attack' && sit.nearestEnemy) {
            if (sit.nearbyEnemies >= 2 || (sit.nearestEnemy.hp / sit.nearestEnemy.maxHp < 0.4)) {
                aiUseUlt(p);
            }
            
            const chaseThreshold = p.weaponType === 'melee' ? 0.8 : 0.95;
            if (sit.enemyDist > getPlayerRange(p) * chaseThreshold && sit.advantage > 1.2) {
                const dx = sit.nearestEnemy.x - p.x;
                const dy = sit.nearestEnemy.y - p.y;
                aiDash(p, dx, dy);
            }
            
            aiDoAttack(p, sit.nearestEnemy, dt);
            return;
        }
    }
    
    // 평상시: 노드 이동
    if (!p.targetNode) {
        p.targetNode = feSelectTargetNode(p);
    }
    
    if (!p.currentNode) {
        p.currentNode = findCurrentNode(p);
    }
    
    const targetNodeObj = game.nodes[p.targetNode];
    
    if (targetNodeObj && distance(p, targetNodeObj) < CONFIG.CHANNEL_RANGE) {
        if (canAttackNode(targetNodeObj, p.team)) {
            aiStartChanneling(p, p.targetNode);
            return;
        } else {
            p.currentNode = p.targetNode;
            p.targetNode = feSelectTargetNode(p);
        }
    }
    
    if (p.targetNode && !canAttackNode(game.nodes[p.targetNode], p.team)) {
        p.targetNode = feSelectTargetNode(p);
    }
    
    if (p.currentNode && p.targetNode && p.currentNode !== p.targetNode) {
        const nextNode = getNextNode(p.currentNode, p.targetNode);
        moveToNode(p, nextNode, speed, dt);
    } else if (p.targetNode) {
        moveToNode(p, p.targetNode, speed, dt);
    }
}

// ==================== 채널링 ====================
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
    if (!node || !canAttackNode(node, p.team)) return;
    
    p.channeling = true;
    p.channelTarget = nodeId;
    p.channelProgress = 0;
    
    let baseTime = NODE_SPECS[node.tier].channelTime;
    if (p.hasBreakerbuff) {
        baseTime *= (1 - getBreakerbuff());
    }
    p.channelTime = baseTime;
    
    p.channelShield = getChannelShield(p);
    p.maxChannelShield = p.channelShield;
}

function cancelChanneling(p) {
    p.channeling = false;
    p.channelTarget = null;
    p.channelProgress = 0;
    p.channelTime = 0;
    p.channelShield = 0;
}

function failChanneling(p) {
    const nodeId = p.channelTarget;
    cancelChanneling(p);
    p.stunTimer = CONFIG.CHANNEL_FAIL_DELAY;
    
    if (nodeId) {
        for (const ally of game.players) {
            if (ally === p) continue;
            if (ally.team === p.team && ally.alive && ally.channeling && ally.channelTarget === nodeId) {
                cancelChanneling(ally);
                ally.stunTimer = CONFIG.CHANNEL_FAIL_DELAY;
            }
        }
    }
}

function completeChanneling(p) {
    const nodeId = p.channelTarget;
    const node = game.nodes[nodeId];
    const spec = NODE_SPECS[node.tier];
    
    node.owner = p.team;
    console.log(`노드 ${nodeId} 점령! 팀 ${p.team}`);
    
    // 브레이커 점령 시
    if (nodeId === 'Breaker') {
        game.breakerClaimCount++;
        for (const ally of game.players) {
            if (ally.team === p.team && ally.alive) {
                ally.hasBreakerbuff = true;
            }
        }
    }
    
    addTeamXP(p.team, spec.value);
    
    // 승리 조건
    if (nodeId === 'B_Guardian' && p.team === 0) {
        game.winner = 0;
    } else if (nodeId === 'A_Guardian' && p.team === 1) {
        game.winner = 1;
    }
    
    cancelChanneling(p);
    
    for (const ally of game.players) {
        if (ally === p) continue;
        if (ally.team === p.team && ally.alive && ally.channeling && ally.channelTarget === nodeId) {
            cancelChanneling(ally);
        }
    }
}

function tryStartChanneling(p) {
    let nearestNode = null;
    let minDist = Infinity;
    
    for (const [id, node] of Object.entries(game.nodes)) {
        if (!canAttackNode(node, p.team)) continue;
        
        const d = distance(p, node);
        if (d < CONFIG.CHANNEL_RANGE && d < minDist) {
            minDist = d;
            nearestNode = id;
        }
    }
    
    if (nearestNode) {
        startChanneling(p, nearestNode);
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
        
        // 중립이거나 DPS 없으면 스킵
        if (node.owner === -1 || spec.dps <= 0) continue;
        
        // 범위 내 적 찾기
        const enemyTeam = 1 - node.owner;
        const enemiesInRange = [];
        
        for (const p of game.players) {
            if (p.team !== enemyTeam || !p.alive) continue;
            if (distance(p, node) < spec.range) {
                enemiesInRange.push(p);
            }
        }
        
        if (enemiesInRange.length === 0) continue;
        
        // DPS 분산
        let dpsPerTarget = spec.dps / enemiesInRange.length;
        
        for (const p of enemiesInRange) {
            // 채널링 중이면 타워 대미지 면역
            if (p.channeling) continue;
            
            // 브레이커 버프: 받는 노드 DPS 감소
            let damage = dpsPerTarget * dt;
            if (p.hasBreakerbuff) {
                damage *= (1 - getBreakerbuff());
            }
            
            p.hp -= damage;
            
            if (p.hp <= 0) {
                p.alive = false;
                p.hp = 0;
                const targetTeamLevel = getTeamLevel(p.team);
                p.respawnTimer = 6 + 2 * targetTeamLevel;
                cancelChanneling(p);
                // 타워 킬은 XP 없음
            }
        }
    }
}

function updateNodeLocks() {
    // T1_L 점령 → A_T2_L, B_T2_L 언락
    if (game.nodes['T1_L'].owner !== -1) {
        game.nodes['A_T2_L'].locked = false;
        game.nodes['B_T2_L'].locked = false;
    }
    
    // T1_R 점령 → A_T2_R, B_T2_R 언락
    if (game.nodes['T1_R'].owner !== -1) {
        game.nodes['A_T2_R'].locked = false;
        game.nodes['B_T2_R'].locked = false;
    }
    
    // A_T2 중 하나 점령 → A_T3 언락
    if (game.nodes['A_T2_L'].owner !== -1 || game.nodes['A_T2_R'].owner !== -1) {
        game.nodes['A_T3'].locked = false;
    }
    
    // B_T2 중 하나 점령 → B_T3 언락
    if (game.nodes['B_T2_L'].owner !== -1 || game.nodes['B_T2_R'].owner !== -1) {
        game.nodes['B_T3'].locked = false;
    }
    
    // B팀이 A_T3 점령 → A_Guardian 영구 언락
    if (game.nodes['A_T3'].owner === 1) {
        game.aGuardianUnlocked = true;
    }
    
    // A팀이 B_T3 점령 → B_Guardian 영구 언락
    if (game.nodes['B_T3'].owner === 0) {
        game.bGuardianUnlocked = true;
    }
    
    // 영구 언락 적용
    if (game.aGuardianUnlocked) {
        game.nodes['A_Guardian'].locked = false;
    }
    if (game.bGuardianUnlocked) {
        game.nodes['B_Guardian'].locked = false;
    }
}

// ==================== 브레이커 시스템 ====================
function getTeamNodeValue(teamId) {
    let total = 0;
    for (const [id, node] of Object.entries(game.nodes)) {
        if (node.owner === teamId && node.tier !== 'Guardian') {
            total += NODE_SPECS[node.tier].value;
        }
    }
    return total;
}

function calculateG() {
    // G = (노드가치A - 노드가치B) + 2*(생존A - 생존B), 정규화
    const nodeA = getTeamNodeValue(0);
    const nodeB = getTeamNodeValue(1);
    
    const aliveA = game.players.filter(p => p.team === 0 && p.alive).length;
    const aliveB = game.players.filter(p => p.team === 1 && p.alive).length;
    
    const rawG = (nodeA - nodeB) + 2 * (aliveA - aliveB);
    return rawG / 20.0; // 정규화 (-1 ~ +1 범위)
}

function checkStalemate() {
    const TAU = 15;
    const EPSILON = 0.07;
    
    const aLv5 = game.teams[0].level >= 5;
    const bLv5 = game.teams[1].level >= 5;
    
    if (!aLv5 && !bLv5) return false;
    
    if (game.gHistory.length === 0) return false;
    
    const currentG = game.gHistory[game.gHistory.length - 1];
    
    let snowballStuck = (aLv5 && currentG > 0) || (bLv5 && currentG < 0);
    
    if (aLv5 && bLv5) snowballStuck = true;
    
    if (!snowballStuck) return false;
    
    if (game.gHistory.length < TAU) return false;
    
    const recent = game.gHistory.slice(-TAU);
    const halfTau = Math.floor(TAU / 2);
    
    const firstHalf = recent.slice(0, halfTau);
    const dg1 = Math.abs(firstHalf[firstHalf.length - 1] - firstHalf[0]) / halfTau;
    
    const secondHalf = recent.slice(halfTau);
    const dg2 = Math.abs(secondHalf[secondHalf.length - 1] - secondHalf[0]) / halfTau;
    
    return dg1 < EPSILON && dg2 < EPSILON;
}

function spawnBreakerIfNeeded() {
    if (checkStalemate()) {
        if (game.firstStalemateTime < 0) {
            game.firstStalemateTime = game.time;
        }
        
        if (!game.breakerSpawned) {
            game.breakerSpawned = true;
            if (game.nodes['Breaker']) {
                game.nodes['Breaker'].locked = false;
                console.log('🔓 브레이커 노드 활성화! (교착 감지)');
            }
        }
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
            channelTarget: p.channelTarget,
            channelProgress: p.channelProgress || 0,
            channelTime: p.channelTime || 0,
            channelShield: p.channelShield || 0,
            maxChannelShield: p.maxChannelShield || 0,
            recalling: p.recalling,
            recallProgress: p.recallProgress || 0,
            respawnTimer: Math.round(p.respawnTimer * 10) / 10,
            isAI: p.isAI,
            hasBreakerbuff: p.hasBreakerbuff || false,
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
