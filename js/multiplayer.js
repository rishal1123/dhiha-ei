/**
 * Thaasbai - Multiplayer Module
 * Unified WebSocket multiplayer framework for all games
 *
 * Adding a new game:
 * 1. Register game config in GAME_CONFIGS
 * 2. Create game-specific SyncManager extending BaseSyncManager
 * 3. Use: Multiplayer.createLobby('gameType') and Multiplayer.createSyncManager('gameType', ...)
 */
(function(window) {
    'use strict';

    // ============================================
    // GAME CONFIGURATIONS
    // Add new games here - the lobby system will auto-configure
    // ============================================

    const GAME_CONFIGS = {
        'dhiha-ei': {
            name: 'Dhiha Ei',
            minPlayers: 4,
            maxPlayers: 4,
            hasTeams: true,
            events: {
                create: 'create_room',
                created: 'room_created',
                join: 'join_room',
                joined: 'room_joined',
                leave: 'leave_room',
                playersChanged: 'players_changed',
                positionChanged: 'position_changed',
                setReady: 'set_ready',
                startGame: 'start_game',
                gameStarted: 'game_started',
                swapPlayer: 'swap_player',
                playerLeft: 'player_disconnected'
            }
        },
        'digu': {
            name: 'Digu',
            minPlayers: 2,
            maxPlayers: 4,
            hasTeams: false,
            events: {
                create: 'create_digu_room',
                created: 'digu_room_created',
                join: 'join_digu_room',
                joined: 'digu_room_joined',
                leave: 'leave_digu_room',
                playersChanged: 'digu_players_changed',
                setReady: 'digu_set_ready',
                startGame: 'start_digu_game',
                gameStarted: 'digu_game_started',
                playerLeft: 'digu_player_left'
            }
        }
        // Add new games here:
        // 'new-game': {
        //     name: 'New Game',
        //     minPlayers: 2,
        //     maxPlayers: 6,
        //     hasTeams: false,
        //     events: { ... }
        // }
    };

    // ============================================
    // PRIVATE STATE
    // ============================================

    let socket = null;
    let currentUserId = null;
    let isConnected = false;
    let onConnectionStatusChanged = null;

    // Visibility/keepalive state
    let keepaliveInterval = null;
    let hiddenTimestamp = null;
    const KEEPALIVE_DURATION = 30000; // 30 seconds
    const KEEPALIVE_INTERVAL = 5000;  // Ping every 5 seconds

    // ============================================
    // CORE FUNCTIONS
    // ============================================

    function getServerUrl() {
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
    // VISIBILITY CHANGE HANDLING
    // Keep connection alive for 30 seconds when tab is inactive
    // ============================================

    function startKeepalive() {
        if (keepaliveInterval) return;

        console.log('[Multiplayer] Tab hidden - starting keepalive for 30s');
        hiddenTimestamp = Date.now();

        keepaliveInterval = setInterval(() => {
            const elapsed = Date.now() - hiddenTimestamp;

            if (elapsed >= KEEPALIVE_DURATION) {
                console.log('[Multiplayer] Keepalive duration exceeded, stopping');
                stopKeepalive();
                return;
            }

            if (socket && isConnected) {
                socket.emit('ping_keepalive');
            }
        }, KEEPALIVE_INTERVAL);
    }

    function stopKeepalive() {
        if (keepaliveInterval) {
            clearInterval(keepaliveInterval);
            keepaliveInterval = null;
            hiddenTimestamp = null;
            console.log('[Multiplayer] Keepalive stopped');
        }
    }

    function handleVisibilityChange() {
        if (document.hidden) {
            startKeepalive();
        } else {
            stopKeepalive();
            if (socket && !isConnected) {
                console.log('[Multiplayer] Tab visible, attempting reconnect');
                socket.connect();
            }
        }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // ============================================
    // BASE LOBBY MANAGER
    // Generic lobby management that works for any game
    // ============================================

    class BaseLobbyManager {
        constructor(gameType) {
            this.gameType = gameType;
            this.config = GAME_CONFIGS[gameType];

            if (!this.config) {
                throw new Error(`Unknown game type: ${gameType}`);
            }

            this.currentRoomId = null;
            this.currentPosition = null;
            this.maxPlayers = this.config.maxPlayers;
            this.onPlayersChanged = null;
            this.onGameStart = null;
            this.onError = null;
            this.onPositionChanged = null;
            this.gameStartData = null;
            this.listenersSetup = false;
        }

        setupSocketListeners() {
            if (!socket || this.listenersSetup) return;
            this.listenersSetup = true;

            const events = this.config.events;
            console.log(`[${this.config.name}Lobby] Setting up listeners`);

            socket.on(events.playersChanged, (data) => {
                console.log(`[${this.config.name}Lobby] players_changed:`, data);
                if (this.onPlayersChanged) {
                    this.onPlayersChanged(data.players);
                }
            });

            if (events.positionChanged) {
                socket.on(events.positionChanged, (data) => {
                    // Update position if it changed
                    for (let i = 0; i < this.maxPlayers; i++) {
                        if (data.players[i]?.oderId === currentUserId) {
                            this.currentPosition = i;
                            break;
                        }
                    }
                    if (this.onPlayersChanged) {
                        this.onPlayersChanged(data.players);
                    }
                    if (this.onPositionChanged) {
                        this.onPositionChanged(this.currentPosition);
                    }
                });
            }

            socket.on(events.gameStarted, (data) => {
                console.log(`[${this.config.name}Lobby] game_started:`, data);
                this.gameStartData = data;
                if (this.onGameStart) {
                    this.onGameStart(data);
                }
            });

            if (events.playerLeft) {
                socket.on(events.playerLeft, (data) => {
                    console.log(`[${this.config.name}Lobby] player_left:`, data);
                    if (this.onPlayersChanged) {
                        this.onPlayersChanged(data.players);
                    }
                });
            }

            socket.on('error', (data) => {
                if (this.onError) {
                    this.onError(data.message);
                }
            });
        }

        async createRoom(hostName, maxPlayers = null) {
            if (!socket || !isConnected) {
                throw new Error('Not connected to server');
            }

            this.setupSocketListeners();
            const events = this.config.events;
            const requestedMaxPlayers = maxPlayers || this.config.maxPlayers;

            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Room creation timeout'));
                }, 10000);

                socket.once(events.created, (data) => {
                    clearTimeout(timeout);
                    this.currentRoomId = data.roomId;
                    this.currentPosition = data.position;
                    this.maxPlayers = data.maxPlayers || requestedMaxPlayers;

                    if (this.onPlayersChanged) {
                        this.onPlayersChanged(data.players);
                    }

                    resolve({
                        roomId: data.roomId,
                        position: data.position,
                        maxPlayers: this.maxPlayers
                    });
                });

                socket.once('error', (data) => {
                    clearTimeout(timeout);
                    reject(new Error(data.message));
                });

                socket.emit(events.create, {
                    playerName: hostName,
                    maxPlayers: requestedMaxPlayers
                });
            });
        }

        async joinRoom(roomId, playerName) {
            if (!socket || !isConnected) {
                throw new Error('Not connected to server');
            }

            this.setupSocketListeners();
            const events = this.config.events;

            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Room join timeout'));
                }, 10000);

                socket.once(events.joined, (data) => {
                    clearTimeout(timeout);
                    this.currentRoomId = data.roomId;
                    this.currentPosition = data.position;
                    this.maxPlayers = data.maxPlayers || this.config.maxPlayers;

                    if (this.onPlayersChanged) {
                        this.onPlayersChanged(data.players);
                    }

                    resolve({
                        roomId: data.roomId,
                        position: data.position,
                        players: data.players,
                        maxPlayers: this.maxPlayers
                    });
                });

                socket.once('error', (data) => {
                    clearTimeout(timeout);
                    reject(new Error(data.message));
                });

                socket.emit(events.join, {
                    roomId: roomId.toUpperCase().trim(),
                    playerName
                });
            });
        }

        async setReady(ready) {
            if (!socket || this.currentPosition === null) return;
            socket.emit(this.config.events.setReady, { ready });
        }

        async startGame(gameState, hands) {
            if (!socket || !this.currentRoomId) return;

            const events = this.config.events;

            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Start game timeout'));
                }, 5000);

                socket.once(events.gameStarted, () => {
                    clearTimeout(timeout);
                    resolve();
                });

                socket.once('error', (data) => {
                    clearTimeout(timeout);
                    reject(new Error(data.message));
                });

                socket.emit(events.startGame, { gameState, hands });
            });
        }

        async leaveRoom() {
            if (!socket) return;

            const events = this.config.events;
            socket.emit(events.leave);

            // Clean up listeners
            socket.off(events.playersChanged);
            socket.off(events.gameStarted);
            if (events.positionChanged) socket.off(events.positionChanged);
            if (events.playerLeft) socket.off(events.playerLeft);

            this.currentRoomId = null;
            this.currentPosition = null;
            this.listenersSetup = false;
        }

        async swapPlayerTeam(fromPosition) {
            if (!this.isHost()) {
                throw new Error('Only host can assign teams');
            }
            if (!socket || !this.config.events.swapPlayer) return;
            socket.emit(this.config.events.swapPlayer, { fromPosition });
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

        getConfig() {
            return this.config;
        }
    }

    // ============================================
    // BASE SYNC MANAGER
    // Generic game state synchronization
    // ============================================

    class BaseSyncManager {
        constructor(gameType, roomId, userId, position) {
            this.gameType = gameType;
            this.config = GAME_CONFIGS[gameType];
            this.roomId = roomId;
            this.userId = userId;
            this.localPosition = position;
            this.isListening = false;
            this.eventHandlers = {};
        }

        on(eventName, handler) {
            this.eventHandlers[eventName] = handler;
        }

        off(eventName) {
            delete this.eventHandlers[eventName];
        }

        emit(eventName, data) {
            if (!socket) return;
            socket.emit(eventName, data);
        }

        listen(eventName, callback) {
            if (!socket) return;
            socket.on(eventName, (data) => {
                if (callback) callback(data);
                if (this.eventHandlers[eventName]) {
                    this.eventHandlers[eventName](data);
                }
            });
        }

        stopListenAll(eventNames) {
            if (!socket) return;
            eventNames.forEach(name => socket.off(name));
        }

        cleanup() {
            this.isListening = false;
            this.eventHandlers = {};
        }
    }

    // ============================================
    // DHIHA EI SYNC MANAGER
    // Trick-taking card game synchronization
    // ============================================

    class DhihaEiSyncManager extends BaseSyncManager {
        constructor(roomId, userId, position) {
            super('dhiha-ei', roomId, userId, position);
            this.onRemoteCardPlayed = null;
            this.onGameStateChanged = null;
            this.onRoundStarted = null;
        }

        startListening() {
            if (this.isListening || !socket) return;
            this.isListening = true;

            socket.on('remote_card_played', (data) => {
                console.log('[DhihaEiSync] Remote card played:', data);
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
            this.stopListenAll(['remote_card_played', 'game_state_updated', 'round_started']);
            this.isListening = false;
        }

        async broadcastCardPlay(card, position) {
            this.emit('card_played', {
                card: { suit: card.suit, rank: card.rank },
                position: position
            });
        }

        async broadcastGameState(state) {
            this.emit('update_game_state', {
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
            const handsData = {};
            hands.forEach((hand, index) => {
                handsData[index] = hand.map(card => ({
                    suit: card.suit,
                    rank: card.rank
                }));
            });

            this.emit('new_round', {
                gameState: initialState,
                hands: handsData
            });
        }

        cleanup() {
            this.stopListening();
            super.cleanup();
        }
    }

    // ============================================
    // DIGU SYNC MANAGER
    // Rummy-style card game synchronization
    // ============================================

    class DiGuSyncManager extends BaseSyncManager {
        constructor(roomId, userId, position) {
            super('digu', roomId, userId, position);
            this.onRemoteCardDrawn = null;
            this.onRemoteCardDiscarded = null;
            this.onRemoteDeclare = null;
            this.onGameStateChanged = null;
            this.onMatchStarted = null;
            this.onRemoteGameOver = null;
        }

        startListening() {
            if (this.isListening || !socket) return;
            this.isListening = true;

            socket.on('digu_remote_card_drawn', (data) => {
                console.log('[DiGuSync] Remote card drawn:', data);
                if (this.onRemoteCardDrawn) {
                    this.onRemoteCardDrawn(data.source, data.card, data.position);
                }
            });

            socket.on('digu_remote_card_discarded', (data) => {
                console.log('[DiGuSync] Remote card discarded:', data);
                if (this.onRemoteCardDiscarded) {
                    this.onRemoteCardDiscarded(data.card, data.position);
                }
            });

            socket.on('digu_remote_declare', (data) => {
                console.log('[DiGuSync] Remote Digu declare:', data);
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
            this.stopListenAll([
                'digu_remote_card_drawn',
                'digu_remote_card_discarded',
                'digu_remote_declare',
                'digu_state_updated',
                'digu_match_started',
                'digu_remote_game_over'
            ]);
            this.isListening = false;
        }

        async broadcastCardDraw(source, card, position) {
            this.emit('digu_draw_card', {
                source: source,
                card: card ? { suit: card.suit, rank: card.rank } : null,
                position: position
            });
        }

        async broadcastCardDiscard(card, position) {
            this.emit('digu_discard_card', {
                card: { suit: card.suit, rank: card.rank },
                position: position
            });
        }

        async broadcastDeclare(melds, isValid, position) {
            const meldsData = melds.map(meld =>
                meld.map(card => ({ suit: card.suit, rank: card.rank }))
            );

            this.emit('digu_declare', {
                melds: meldsData,
                isValid: isValid,
                position: position
            });
        }

        async broadcastGameState(state) {
            this.emit('digu_update_state', {
                gameState: {
                    currentPlayerIndex: state.currentPlayerIndex,
                    phase: state.phase,
                    stockCount: state.stockCount,
                    discardTop: state.discardTop ? { suit: state.discardTop.suit, rank: state.discardTop.rank } : null
                }
            });
        }

        async broadcastGameOver(results) {
            this.emit('digu_game_over', { results: results });
        }

        async broadcastNewMatch(gameState, hands) {
            const handsData = {};
            hands.forEach((hand, index) => {
                handsData[index] = hand.map(card => ({
                    suit: card.suit,
                    rank: card.rank
                }));
            });

            this.emit('digu_new_match', {
                gameState: gameState,
                hands: handsData
            });
        }

        cleanup() {
            this.stopListening();
            super.cleanup();
        }
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
    // SYNC MANAGER REGISTRY
    // Maps game types to their sync manager classes
    // ============================================

    const SYNC_MANAGERS = {
        'dhiha-ei': DhihaEiSyncManager,
        'digu': DiGuSyncManager
        // Add new sync managers here:
        // 'new-game': NewGameSyncManager
    };

    // ============================================
    // FACTORY FUNCTIONS
    // ============================================

    function createLobby(gameType) {
        return new BaseLobbyManager(gameType);
    }

    function createSyncManager(gameType, roomId, userId, position) {
        const SyncManagerClass = SYNC_MANAGERS[gameType];
        if (!SyncManagerClass) {
            throw new Error(`No sync manager for game type: ${gameType}`);
        }
        return new SyncManagerClass(roomId, userId, position);
    }

    function getGameConfig(gameType) {
        return GAME_CONFIGS[gameType];
    }

    function getAvailableGames() {
        return Object.keys(GAME_CONFIGS).map(key => ({
            type: key,
            ...GAME_CONFIGS[key]
        }));
    }

    // ============================================
    // BACKWARD COMPATIBILITY
    // Keep old class names working
    // ============================================

    // Dhiha Ei legacy classes
    class LobbyManager extends BaseLobbyManager {
        constructor() {
            super('dhiha-ei');
        }
    }

    class GameSyncManager extends DhihaEiSyncManager {
        constructor(roomId, userId, position) {
            super(roomId, userId, position);
        }
    }

    // Digu legacy classes
    class DiGuLobbyManager extends BaseLobbyManager {
        constructor() {
            super('digu');
        }
    }

    // ============================================
    // PUBLIC API
    // ============================================

    window.Multiplayer = {
        // Core
        init: initializeMultiplayer,
        isAvailable: isMultiplayerAvailable,
        getSocket: function() { return socket; },
        getCurrentUserId: function() { return currentUserId; },
        setConnectionCallback: function(callback) {
            onConnectionStatusChanged = callback;
        },

        // Factory methods (recommended for new code)
        createLobby: createLobby,
        createSyncManager: createSyncManager,
        getGameConfig: getGameConfig,
        getAvailableGames: getAvailableGames,

        // Base classes (for extending)
        BaseLobbyManager: BaseLobbyManager,
        BaseSyncManager: BaseSyncManager,

        // Game-specific sync managers
        DhihaEiSyncManager: DhihaEiSyncManager,
        DiGuSyncManager: DiGuSyncManager,

        // Presence
        PresenceManager: PresenceManager,

        // Legacy classes (backward compatibility)
        LobbyManager: LobbyManager,
        GameSyncManager: GameSyncManager,
        DiGuLobbyManager: DiGuLobbyManager,

        // Game configs
        GAME_CONFIGS: GAME_CONFIGS
    };

})(window);
