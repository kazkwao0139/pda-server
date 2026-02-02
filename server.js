// PDA 멀티플레이어 서버
const http = require('http').createServer((req, res) => {
    res.writeHead(200);
    res.end('PDA Server Running');
});

const io = require('socket.io')(http, {
    cors: { origin: "*" }
});

let lobbyPlayers = [];
let gameStarted = false;
let hostId = null;

io.on('connection', (socket) => {
    console.log('플레이어 접속:', socket.id);
    
    if (lobbyPlayers.length === 0) {
        hostId = socket.id;
        console.log('호스트 지정:', socket.id);
    }
    
    socket.on('join_lobby', (data) => {
        const player = {
            id: socket.id,
            name: data.name || `Player ${lobbyPlayers.length + 1}`,
            team: lobbyPlayers.length % 2,
            isHost: socket.id === hostId
        };
        lobbyPlayers.push(player);
        io.emit('lobby_update', { players: lobbyPlayers, hostId });
        console.log('로비:', lobbyPlayers.map(p => p.name));
    });
    
    socket.on('change_team', (team) => {
        const player = lobbyPlayers.find(p => p.id === socket.id);
        if (player) {
            player.team = team;
            io.emit('lobby_update', { players: lobbyPlayers, hostId });
        }
    });
    
    socket.on('start_game', () => {
        if (socket.id === hostId && !gameStarted) {
            gameStarted = true;
            io.emit('game_start', { players: lobbyPlayers });
            console.log('게임 시작!');
        }
    });
    
    // 입력을 모든 플레이어에게 브로드캐스트
    socket.on('player_input', (data) => {
        socket.broadcast.emit('player_input', {
            odI: socket.id,
            input: data
        });
    });
    
    // 게임 상태 동기화 (위치 보정용)
    socket.on('game_state', (state) => {
        if (socket.id === hostId) {
            socket.broadcast.emit('game_state', state);
        }
    });
    
    socket.on('disconnect', () => {
        console.log('플레이어 퇴장:', socket.id);
        lobbyPlayers = lobbyPlayers.filter(p => p.id !== socket.id);
        
        if (socket.id === hostId) {
            hostId = lobbyPlayers.length > 0 ? lobbyPlayers[0].id : null;
            gameStarted = false;
            if (hostId) lobbyPlayers[0].isHost = true;
        }
        
        io.emit('lobby_update', { players: lobbyPlayers, hostId });
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log('PDA 서버 시작! 포트:', PORT);
});
