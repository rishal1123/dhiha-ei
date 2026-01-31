/**
 * Thaasbai - Multiplayer Module
 * Shared WebSocket multiplayer functionality for all games
 */
(function(window) {
    'use strict';

    // ============================================
    // PRIVATE STATE
    // ============================================

    let socket = null;
    let currentUserId = null;
    let isConnected = false;
    let onConnectionStatusChanged = null;

    // ============================================
    // PRIVATE FUNCTIONS
    // ============================================

    function getServerUrl() {
        // Use same origin for production, or configure for development
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            return window.location.origin;
        }
        return window.location.origin;
    }

    function initializeMultiplayer() {
        if (typeof io === 'undefined') {
            console.warn('[Multiplayer] Socket.IO not loaded - multiplayer disabled');
            return false;
        }

        try {
            const serverUrl = getServerUrl();
            console.log('[Multiplayer] Connecting to server:', serverUrl);
            socket = io(serverUrl, {
                transports: ['websocket', 'polling'],
                reconnection: true,
                reconnectionAttempts: 5,
                reconnectionDelay: 1000
            });

            socket.on('connect', () => {
                console.log('[Multiplayer] Connected to server');
                isConnected = true;
            });

            socket.on('connected', (data) => {
                currentUserId = data.sid;
                console.log('[Multiplayer] Session established:', currentUserId);
            });

            socket.on('disconnect', (reason) => {
                console.warn('[Multiplayer] Disconnected from server:', reason);
                isConnected = false;
                if (onConnectionStatusChanged) {
                    onConnectionStatusChanged(false, reason);
                }
            });

            socket.on('reconnect', (attemptNumber) => {
                console.log('[Multiplayer] Reconnected to server, attempts:', attemptNumber);
                isConnected = true;
                if (onConnectionStatusChanged) {
                    onConnectionStatusChanged(true, 'reconnected');
                }
            });

            socket.on('reconnect_attempt', (attemptNumber) => {
                console.log('[Multiplayer] Reconnection attempt:', attemptNumber);
            });

            socket.on('reconnect_failed', () => {
                console.error('[Multiplayer] Failed to reconnect to server');
                if (onConnectionStatusChanged) {
                    onConnectionStatusChanged(false, 'reconnect_failed');
                }
            });

            socket.on('connect_error', (error) => {
                console.error('[Multiplayer] Connection error:', error);
                isConnected = false;
            });

            console.log('[Multiplayer] Initialized successfully');
            return true;
        } catch (error) {
            console.error('[Multiplayer] Initialization error:', error);
            return false;
        }
    }

    function isMultiplayerAvailable() {
        return socket && isConnected;
    }

    // ============================================
    // PRESENCE MANAGER
    // ============================================

    class PresenceManager {
        constructor(roomId, userId, position) {
            this.roomId = roomId;
            this.userId = userId;
            this.position = position;
            this.onPlayerDisconnected = null;
        }

        async setupPresence() {
            if (!socket) return;

            socket.on('player_disconnected', (data) => {
                if (this.onPlayerDisconnected) {
                    this.onPlayerDisconnected(data.position, data.players);
                }
            });
        }

        cleanup() {
            if (socket) {
                socket.off('player_disconnected');
            }
        }
    }

    // ============================================
    // LOBBY MANAGER (Dhiha Ei)
    // ============================================

    class LobbyManager {
        constructor() {
            this.currentRoomId = null;
            this.currentPosition = null;
            this.onPlayersChanged = null;
            this.onGameStart = null;
            this.onError = null;
            this.onPositionChanged = null;
            this.gameStartData = null;
        }

        setupSocketListeners() {
            if (!socket) {
                console.error('[LobbyManager] setupSocketListeners called but socket is null!');
                return;
            }
            console.log('[LobbyManager] Setting up listeners');

            socket.on('players_changed', (data) => {
                console.log('[LobbyManager] players_changed received:', data);
                if (this.onPlayersChanged) {
                    this.onPlayersChanged(data.players);
                }
            });

            socket.on('position_changed', (data) => {
                for (const [sid, pos] of Object.entries(data.players || {})) {
                    if (data.players[this.currentPosition]?.oderId !== currentUserId) {
                        for (let i = 0; i < 4; i++) {
                            if (data.players[i]?.oderId === currentUserId) {
                                this.currentPosition = i;
                                break;
                            }
                        }
                    }
                }
                if (this.onPlayersChanged) {
                    this.onPlayersChanged(data.players);
                }
                if (this.onPositionChanged) {
                    this.onPositionChanged(this.currentPosition);
                }
            });

            socket.on('game_started', (data) => {
                console.log('[LobbyManager] game_started event received:', data);
                this.gameStartData = data;
                if (this.onGameStart) {
                    this.onGameStart(data);
                }
            });

            socket.on('error', (data) => {
                if (this.onError) {
                    this.onError(data.message);
                }
            });
        }

        async createRoom(hostName) {
            if (!socket || !isConnected) {
                throw new Error('Not connected to server');
            }

            this.setupSocketListeners();

            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Room creation timeout'));
                }, 10000);

                socket.once('room_created', (data) => {
                    clearTimeout(timeout);
                    this.currentRoomId = data.roomId;
                    this.currentPosition = data.position;

                    if (this.onPlayersChanged) {
                        this.onPlayersChanged(data.players);
                    }

                    resolve({ roomId: data.roomId, position: data.position });
                });

                socket.once('error', (data) => {
                    clearTimeout(timeout);
                    reject(new Error(data.message));
                });

                socket.emit('create_room', { playerName: hostName });
            });
        }

        async joinRoom(roomId, playerName) {
            if (!socket || !isConnected) {
                throw new Error('Not connected to server');
            }

            this.setupSocketListeners();

            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Room join timeout'));
                }, 10000);

                socket.once('room_joined', (data) => {
                    clearTimeout(timeout);
                    this.currentRoomId = data.roomId;
                    this.currentPosition = data.position;

                    if (this.onPlayersChanged) {
                        this.onPlayersChanged(data.players);
                    }

                    resolve({
                        roomId: data.roomId,
                        position: data.position,
                        players: data.players
                    });
                });

                socket.once('error', (data) => {
                    clearTimeout(timeout);
                    reject(new Error(data.message));
                });

                socket.emit('join_room', {
                    roomId: roomId.toUpperCase().trim(),
                    playerName
                });
            });
        }

        async setReady(ready) {
            if (!socket || this.currentPosition === null) return;
            socket.emit('set_ready', { ready });
        }

        async startGame(gameState, hands) {
            if (!socket || !this.currentRoomId) return;

            return new Promise((resolve, reject) => {
                socket.emit('start_game', { gameState, hands });

                const timeout = setTimeout(() => {
                    reject(new Error('Start game timeout'));
                }, 5000);

                socket.once('game_started', () => {
                    clearTimeout(timeout);
                    resolve();
                });

                socket.once('error', (data) => {
                    clearTimeout(timeout);
                    reject(new Error(data.message));
                });
            });
        }

        async leaveRoom() {
            if (!socket) return;

            socket.emit('leave_room');

            socket.off('players_changed');
            socket.off('position_changed');
            socket.off('game_started');

            this.currentRoomId = null;
            this.currentPosition = null;
        }

        isHost() {
            return this.currentPosition === 0;
        }

        getRoomId() {
            return this.currentRoomId;
        }

        getPosition() {
            return this.currentPosition;
        }

        getGameStartData() {
            return this.gameStartData;
        }

        async swapPlayerTeam(fromPosition) {
            if (!this.isHost()) {
                throw new Error('Only host can assign teams');
            }
            if (!socket) return;
            socket.emit('swap_player', { fromPosition });
        }
    }

    // ============================================
    // GAME SYNC MANAGER (Dhiha Ei)
    // ============================================

    class GameSyncManager {
        constructor(roomId, userId, position) {
            this.roomId = roomId;
            this.userId = userId;
            this.localPosition = position;
            this.onRemoteCardPlayed = null;
            this.onGameStateChanged = null;
            this.onRoundStarted = null;
            this.isListening = false;
        }

        async initialize() {
            // No initialization needed for WebSocket
        }

        startListening() {
            if (this.isListening || !socket) return;
            this.isListening = true;

            socket.on('remote_card_played', (data) => {
                console.log('[GameSyncManager] Remote card played:', data);
                if (this.onRemoteCardPlayed) {
                    this.onRemoteCardPlayed(data.card, data.position);
                }
            });

            socket.on('game_state_updated', (data) => {
                if (this.onGameStateChanged) {
                    this.onGameStateChanged(data.gameState);
                }
            });

            socket.on('round_started', (data) => {
                if (this.onRoundStarted) {
                    this.onRoundStarted(data.gameState, data.hands);
                }
            });
        }

        stopListening() {
            if (socket) {
                socket.off('remote_card_played');
                socket.off('game_state_updated');
                socket.off('round_started');
            }
            this.isListening = false;
        }

        async broadcastCardPlay(card, position) {
            if (!socket) return;

            socket.emit('card_played', {
                card: { suit: card.suit, rank: card.rank },
                position: position
            });
        }

        async broadcastGameState(state) {
            if (!socket) return;

            socket.emit('update_game_state', {
                gameState: {
                    currentPlayerIndex: state.currentPlayerIndex,
                    trickNumber: state.trickNumber,
                    superiorSuit: state.superiorSuit || null,
                    tricksWon: state.tricksWon,
                    tensCollected: state.tensCollected,
                    roundOver: state.roundOver || false,
                    roundResult: state.roundResult || null,
                    matchPoints: state.matchPoints,
                    matchOver: state.matchOver || false
                }
            });
        }

        async broadcastNewRound(initialState, hands) {
            if (!socket) return;

            const handsData = {};
            hands.forEach((hand, index) => {
                handsData[index] = hand.map(card => ({
                    suit: card.suit,
                    rank: card.rank
                }));
            });

            socket.emit('new_round', {
                gameState: initialState,
                hands: handsData
            });
        }

        cleanup() {
            this.stopListening();
        }
    }

    // ============================================
    // DIGU LOBBY MANAGER
    // ============================================

    class DiGuLobbyManager {
        constructor() {
            this.currentRoomId = null;
            this.currentPosition = null;
            this.maxPlayers = 4;
            this.onPlayersChanged = null;
            this.onGameStart = null;
            this.onError = null;
            this.gameStartData = null;
        }

        setupSocketListeners() {
            if (!socket) {
                console.error('[DiGuLobbyManager] socket is null');
                return;
            }
            console.log('[DiGuLobbyManager] Setting up listeners');

            socket.on('digu_players_changed', (data) => {
                console.log('[DiGuLobbyManager] digu_players_changed received:', data);
                if (this.onPlayersChanged) {
                    this.onPlayersChanged(data.players);
                }
            });

            socket.on('digu_game_started', (data) => {
                console.log('[DiGuLobbyManager] digu_game_started event received:', data);
                this.gameStartData = data;
                if (this.onGameStart) {
                    this.onGameStart(data);
                }
            });

            socket.on('digu_player_left', (data) => {
                console.log('[DiGuLobbyManager] digu_player_left:', data);
                if (this.onPlayersChanged) {
                    this.onPlayersChanged(data.players);
                }
            });

            socket.on('error', (data) => {
                if (this.onError) {
                    this.onError(data.message);
                }
            });
        }

        async createRoom(hostName, maxPlayers = 4) {
            if (!socket || !isConnected) {
                throw new Error('Not connected to server');
            }

            return new Promise((resolve, reject) => {
                socket.emit('create_digu_room', { playerName: hostName, maxPlayers });

                socket.once('digu_room_created', (data) => {
                    this.currentRoomId = data.roomId;
                    this.currentPosition = data.position;
                    this.maxPlayers = data.maxPlayers;
                    this.setupSocketListeners();

                    if (this.onPlayersChanged) {
                        this.onPlayersChanged(data.players);
                    }

                    resolve({ roomId: data.roomId, position: data.position, maxPlayers: data.maxPlayers });
                });

                socket.once('error', (data) => {
                    reject(new Error(data.message));
                });
            });
        }

        async joinRoom(roomId, playerName) {
            if (!socket || !isConnected) {
                throw new Error('Not connected to server');
            }

            return new Promise((resolve, reject) => {
                socket.emit('join_digu_room', {
                    roomId: roomId.toUpperCase().trim(),
                    playerName
                });

                socket.once('digu_room_joined', (data) => {
                    this.currentRoomId = data.roomId;
                    this.currentPosition = data.position;
                    this.maxPlayers = data.maxPlayers;
                    this.setupSocketListeners();

                    if (this.onPlayersChanged) {
                        this.onPlayersChanged(data.players);
                    }

                    resolve({
                        roomId: data.roomId,
                        position: data.position,
                        players: data.players,
                        maxPlayers: data.maxPlayers
                    });
                });

                socket.once('error', (data) => {
                    reject(new Error(data.message));
                });
            });
        }

        async setReady(ready) {
            if (!socket || this.currentPosition === null) return;
            socket.emit('digu_set_ready', { ready });
        }

        async startGame(gameState, hands) {
            if (!socket || !this.currentRoomId) return;

            return new Promise((resolve, reject) => {
                socket.emit('start_digu_game', { gameState, hands });

                const timeout = setTimeout(() => {
                    reject(new Error('Start game timeout'));
                }, 5000);

                socket.once('digu_game_started', () => {
                    clearTimeout(timeout);
                    resolve();
                });

                socket.once('error', (data) => {
                    clearTimeout(timeout);
                    reject(new Error(data.message));
                });
            });
        }

        async leaveRoom() {
            if (!socket) return;

            socket.emit('leave_digu_room');

            socket.off('digu_players_changed');
            socket.off('digu_game_started');
            socket.off('digu_player_left');

            this.currentRoomId = null;
            this.currentPosition = null;
        }

        isHost() {
            return this.currentPosition === 0;
        }

        getRoomId() {
            return this.currentRoomId;
        }

        getPosition() {
            return this.currentPosition;
        }

        getMaxPlayers() {
            return this.maxPlayers;
        }

        getGameStartData() {
            return this.gameStartData;
        }
    }

    // ============================================
    // DIGU SYNC MANAGER
    // ============================================

    class DiGuSyncManager {
        constructor(roomId, userId, position) {
            this.roomId = roomId;
            this.userId = userId;
            this.localPosition = position;
            this.onRemoteCardDrawn = null;
            this.onRemoteCardDiscarded = null;
            this.onRemoteDeclare = null;
            this.onGameStateChanged = null;
            this.onMatchStarted = null;
            this.onRemoteGameOver = null;
            this.isListening = false;
        }

        startListening() {
            if (this.isListening || !socket) return;
            this.isListening = true;

            socket.on('digu_remote_card_drawn', (data) => {
                console.log('[DiGuSyncManager] Remote card drawn:', data);
                if (this.onRemoteCardDrawn) {
                    this.onRemoteCardDrawn(data.source, data.card, data.position);
                }
            });

            socket.on('digu_remote_card_discarded', (data) => {
                console.log('[DiGuSyncManager] Remote card discarded:', data);
                if (this.onRemoteCardDiscarded) {
                    this.onRemoteCardDiscarded(data.card, data.position);
                }
            });

            socket.on('digu_remote_declare', (data) => {
                console.log('[DiGuSyncManager] Remote Digu declare:', data);
                if (this.onRemoteDeclare) {
                    this.onRemoteDeclare(data.position, data.melds, data.isValid);
                }
            });

            socket.on('digu_state_updated', (data) => {
                if (this.onGameStateChanged) {
                    this.onGameStateChanged(data.gameState);
                }
            });

            socket.on('digu_match_started', (data) => {
                if (this.onMatchStarted) {
                    this.onMatchStarted(data.gameState, data.hands);
                }
            });

            socket.on('digu_remote_game_over', (data) => {
                if (this.onRemoteGameOver) {
                    this.onRemoteGameOver(data.results, data.declaredBy);
                }
            });
        }

        stopListening() {
            if (socket) {
                socket.off('digu_remote_card_drawn');
                socket.off('digu_remote_card_discarded');
                socket.off('digu_remote_declare');
                socket.off('digu_state_updated');
                socket.off('digu_match_started');
                socket.off('digu_remote_game_over');
            }
            this.isListening = false;
        }

        async broadcastCardDraw(source, card, position) {
            if (!socket) return;

            socket.emit('digu_draw_card', {
                source: source,
                card: card ? { suit: card.suit, rank: card.rank } : null,
                position: position
            });
        }

        async broadcastCardDiscard(card, position) {
            if (!socket) return;

            socket.emit('digu_discard_card', {
                card: { suit: card.suit, rank: card.rank },
                position: position
            });
        }

        async broadcastDeclare(melds, isValid, position) {
            if (!socket) return;

            const meldsData = melds.map(meld =>
                meld.map(card => ({ suit: card.suit, rank: card.rank }))
            );

            socket.emit('digu_declare', {
                melds: meldsData,
                isValid: isValid,
                position: position
            });
        }

        async broadcastGameState(state) {
            if (!socket) return;

            socket.emit('digu_update_state', {
                gameState: {
                    currentPlayerIndex: state.currentPlayerIndex,
                    phase: state.phase,
                    stockCount: state.stockCount,
                    discardTop: state.discardTop ? { suit: state.discardTop.suit, rank: state.discardTop.rank } : null
                }
            });
        }

        async broadcastGameOver(results) {
            if (!socket) return;

            socket.emit('digu_game_over', {
                results: results
            });
        }

        async broadcastNewMatch(gameState, hands) {
            if (!socket) return;

            const handsData = {};
            hands.forEach((hand, index) => {
                handsData[index] = hand.map(card => ({
                    suit: card.suit,
                    rank: card.rank
                }));
            });

            socket.emit('digu_new_match', {
                gameState: gameState,
                hands: handsData
            });
        }

        cleanup() {
            this.stopListening();
        }
    }

    // ============================================
    // PUBLIC API
    // ============================================

    window.Multiplayer = {
        // Initialization
        init: initializeMultiplayer,
        isAvailable: isMultiplayerAvailable,

        // Socket access (for direct operations like matchmaking)
        getSocket: function() { return socket; },
        getCurrentUserId: function() { return currentUserId; },

        // Connection status callback
        setConnectionCallback: function(callback) {
            onConnectionStatusChanged = callback;
        },

        // Classes
        PresenceManager: PresenceManager,
        LobbyManager: LobbyManager,
        GameSyncManager: GameSyncManager,
        DiGuLobbyManager: DiGuLobbyManager,
        DiGuSyncManager: DiGuSyncManager
    };

})(window);
