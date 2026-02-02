// PDA 멀티플레이어 서버
const http = require('http').createServer();
const io = require('socket.io')(http, {
    cors: { origin: "*" }
});

// 로비 상태
let lobbyPlayers = [];
let gameStarted = false;
let hostId = null;

io.on('connection', (socket) => {
    console.log('플레이어 접속:', socket.id);
    
    // 호스트인지 확인 (첫 번째 접속자)
    if (lobbyPlayers.length === 0) {
        hostId = socket.id;
        console.log('호스트 지정:', socket.id);
    }
    
    // 로비 참가
    socket.on('join_lobby', (data) => {
        const player = {
            id: socket.id,
            name: data.name || `Player ${lobbyPlayers.length + 1}`,
            team: lobbyPlayers.length % 2,  // 번갈아 팀 배정
            isHost: socket.id === hostId
        };
        lobbyPlayers.push(player);
        
        // 모든 플레이어에게 로비 상태 전송
        io.emit('lobby_update', { players: lobbyPlayers, hostId });
        console.log('로비:', lobbyPlayers.map(p => p.name));
    });
    
    // 팀 변경
    socket.on('change_team', (team) => {
        const player = lobbyPlayers.find(p => p.id === socket.id);
        if (player) {
            player.team = team;
            io.emit('lobby_update', { players: lobbyPlayers, hostId });
        }
    });
    
    // 게임 시작 (호스트만)
    socket.on('start_game', () => {
        if (socket.id === hostId && !gameStarted) {
            gameStarted = true;
            io.emit('game_start', { players: lobbyPlayers });
            console.log('게임 시작!');
        }
    });
    
    // 플레이어 입력 전송 (클라이언트 → 서버 → 호스트)
    socket.on('player_input', (data) => {
        // 호스트에게만 전달
        if (hostId && socket.id !== hostId) {
            io.to(hostId).emit('player_input', {
                id: socket.id,
                input: data
            });
        }
    });
    
    // 게임 상태 동기화 (호스트 → 서버 → 모든 클라이언트)
    socket.on('game_state', (state) => {
        if (socket.id === hostId) {
            socket.broadcast.emit('game_state', state);
        }
    });
    
    // 연결 해제
    socket.on('disconnect', () => {
        console.log('플레이어 퇴장:', socket.id);
        lobbyPlayers = lobbyPlayers.filter(p => p.id !== socket.id);
        
        // 호스트가 나가면 게임 리셋
        if (socket.id === hostId) {
            console.log('호스트 퇴장 - 게임 리셋');
            hostId = lobbyPlayers.length > 0 ? lobbyPlayers[0].id : null;
            gameStarted = false;
            if (hostId) {
                lobbyPlayers[0].isHost = true;
            }
        }
        
        io.emit('lobby_update', { players: lobbyPlayers, hostId });
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log('========================================');
    console.log('  PDA 멀티플레이어 서버 시작!');
    console.log('  포트:', PORT);
    console.log('========================================');
    console.log('');
    console.log('  다른 PC에서 접속하려면:');
    console.log('  cmd에서 ipconfig 쳐서 IPv4 주소 확인');
    console.log('');
});
