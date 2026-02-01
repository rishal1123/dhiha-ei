# Thaasbai Flutter + Firebase Migration Guide

A comprehensive guide to rewriting the Thaasbai card games (Dhiha Ei & Digu) in Flutter with Firebase for Web, iOS, and Android.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Project Setup](#2-project-setup)
3. [Firebase Configuration](#3-firebase-configuration)
4. [Project Structure](#4-project-structure)
5. [Data Models](#5-data-models)
6. [State Management](#6-state-management)
7. [Authentication](#7-authentication)
8. [Real-time Multiplayer](#8-real-time-multiplayer)
9. [Game Logic Migration](#9-game-logic-migration)
10. [UI Components](#10-ui-components)
11. [Card Rendering](#11-card-rendering)
12. [Animations](#12-animations)
13. [Localization](#13-localization)
14. [Platform-Specific Considerations](#14-platform-specific-considerations)
15. [Testing](#15-testing)
16. [Deployment](#16-deployment)
17. [Migration Checklist](#17-migration-checklist)

---

## 1. Architecture Overview

### Current Architecture (JavaScript + Python)

```
┌─────────────────────────────────────────────────────────┐
│                      Client (Browser)                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │  HTML/CSS   │  │   JS Game   │  │   Socket.IO     │  │
│  │     UI      │  │    Logic    │  │     Client      │  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────┘
                           │
                    WebSocket (Socket.IO)
                           │
┌─────────────────────────────────────────────────────────┐
│                   Server (Python Flask)                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │   Rooms     │  │  Game State │  │   Matchmaking   │  │
│  │  Manager    │  │   Manager   │  │     Queue       │  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### New Architecture (Flutter + Firebase)

```
┌─────────────────────────────────────────────────────────┐
│              Flutter App (Web/iOS/Android)               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │   Flutter   │  │    Dart     │  │    Firebase     │  │
│  │   Widgets   │  │  Game Logic │  │     SDKs        │  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────┘
                           │
                   Firebase Services
                           │
┌─────────────────────────────────────────────────────────┐
│                    Firebase Backend                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  │
│  │Firestore │  │ Realtime │  │   Auth   │  │Functions│  │
│  │    DB    │  │    DB    │  │          │  │         │  │
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Key Differences

| Aspect | Current | Flutter + Firebase |
|--------|---------|-------------------|
| UI | HTML/CSS/JS | Flutter Widgets |
| State | JS Objects | Riverpod/Bloc |
| Realtime | Socket.IO | Firebase Realtime DB |
| Server | Python Flask | Firebase Functions |
| Auth | Session-based | Firebase Auth |
| Database | In-memory | Firestore |

---

## 2. Project Setup

### Prerequisites

```bash
# Install Flutter
# Visit: https://docs.flutter.dev/get-started/install

# Verify installation
flutter doctor

# Install Firebase CLI
npm install -g firebase-tools

# Login to Firebase
firebase login

# Install FlutterFire CLI
dart pub global activate flutterfire_cli
```

### Create Flutter Project

```bash
# Create new Flutter project
flutter create thaasbai_flutter --platforms=web,ios,android

cd thaasbai_flutter

# Add dependencies
flutter pub add firebase_core
flutter pub add firebase_auth
flutter pub add cloud_firestore
flutter pub add firebase_database
flutter pub add firebase_analytics
flutter pub add riverpod
flutter pub add flutter_riverpod
flutter pub add go_router
flutter pub add freezed_annotation
flutter pub add json_annotation
flutter pub add flutter_svg
flutter pub add audioplayers
flutter pub add shared_preferences
flutter pub add flutter_localizations

# Dev dependencies
flutter pub add --dev build_runner
flutter pub add --dev freezed
flutter pub add --dev json_serializable
```

### Configure FlutterFire

```bash
# Initialize Firebase in your project
flutterfire configure

# Select your Firebase project
# This generates lib/firebase_options.dart
```

---

## 3. Firebase Configuration

### Firebase Project Setup

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create new project: "Thaasbai"
3. Enable the following services:

#### Authentication
- Enable Anonymous Auth (for guest players)
- Enable Google Sign-In (optional)
- Enable Apple Sign-In (for iOS)

#### Firestore Database

Create these collections:

```
/users/{userId}
  - displayName: string
  - gamesPlayed: number
  - gamesWon: number
  - createdAt: timestamp

/rooms/{roomId}
  - gameType: "dhiha-ei" | "digu"
  - status: "waiting" | "playing" | "finished"
  - hostId: string
  - maxPlayers: number
  - createdAt: timestamp
  - players: map<position, PlayerData>

/games/{gameId}
  - roomId: string
  - gameType: string
  - currentTurn: number
  - gameState: map
  - hands: map<position, Card[]> (encrypted/private)
  - stockPile: Card[]
  - discardPile: Card[]
  - scores: map<position, number>

/matchmaking/{queueId}
  - gameType: string
  - userId: string
  - displayName: string
  - joinedAt: timestamp
```

#### Realtime Database

For low-latency game actions:

```json
{
  "presence": {
    "{roomId}": {
      "{position}": {
        "connected": true,
        "lastSeen": 1234567890
      }
    }
  },
  "gameActions": {
    "{roomId}": {
      "{actionId}": {
        "type": "play_card",
        "position": 0,
        "data": {},
        "timestamp": 1234567890
      }
    }
  }
}
```

#### Security Rules

**Firestore Rules:**

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can read/write their own profile
    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth.uid == userId;
    }

    // Rooms are readable by anyone, writable by players
    match /rooms/{roomId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      allow update: if request.auth != null &&
        (resource.data.hostId == request.auth.uid ||
         request.auth.uid in resource.data.playerIds);
      allow delete: if resource.data.hostId == request.auth.uid;
    }

    // Games are only accessible by players in that game
    match /games/{gameId} {
      allow read, write: if request.auth != null &&
        request.auth.uid in get(/databases/$(database)/documents/rooms/$(resource.data.roomId)).data.playerIds;
    }

    // Matchmaking queue
    match /matchmaking/{queueId} {
      allow read: if request.auth != null;
      allow create: if request.auth.uid == request.resource.data.userId;
      allow delete: if request.auth.uid == resource.data.userId;
    }
  }
}
```

**Realtime Database Rules:**

```json
{
  "rules": {
    "presence": {
      "$roomId": {
        ".read": "auth != null",
        ".write": "auth != null"
      }
    },
    "gameActions": {
      "$roomId": {
        ".read": "auth != null",
        "$actionId": {
          ".write": "auth != null && newData.child('userId').val() == auth.uid"
        }
      }
    }
  }
}
```

---

## 4. Project Structure

```
lib/
├── main.dart
├── firebase_options.dart
├── app.dart
│
├── core/
│   ├── constants/
│   │   ├── app_colors.dart
│   │   ├── app_strings.dart
│   │   └── game_constants.dart
│   ├── theme/
│   │   └── app_theme.dart
│   ├── utils/
│   │   ├── card_utils.dart
│   │   └── game_utils.dart
│   └── extensions/
│       └── list_extensions.dart
│
├── data/
│   ├── models/
│   │   ├── card.dart
│   │   ├── player.dart
│   │   ├── room.dart
│   │   ├── game_state.dart
│   │   └── meld.dart
│   ├── repositories/
│   │   ├── auth_repository.dart
│   │   ├── room_repository.dart
│   │   ├── game_repository.dart
│   │   └── matchmaking_repository.dart
│   └── services/
│       ├── firebase_service.dart
│       ├── presence_service.dart
│       └── audio_service.dart
│
├── domain/
│   ├── game_logic/
│   │   ├── card_game.dart
│   │   ├── dhiha_ei_game.dart
│   │   └── digu_game.dart
│   ├── ai/
│   │   ├── ai_player.dart
│   │   ├── dhiha_ei_ai.dart
│   │   └── digu_ai.dart
│   └── validators/
│       ├── meld_validator.dart
│       └── move_validator.dart
│
├── presentation/
│   ├── providers/
│   │   ├── auth_provider.dart
│   │   ├── room_provider.dart
│   │   ├── game_provider.dart
│   │   └── settings_provider.dart
│   ├── screens/
│   │   ├── home/
│   │   │   └── home_screen.dart
│   │   ├── lobby/
│   │   │   ├── lobby_screen.dart
│   │   │   ├── waiting_room_screen.dart
│   │   │   └── matchmaking_screen.dart
│   │   ├── game/
│   │   │   ├── dhiha_ei_game_screen.dart
│   │   │   └── digu_game_screen.dart
│   │   └── settings/
│   │       └── settings_screen.dart
│   └── widgets/
│       ├── common/
│       │   ├── app_button.dart
│       │   └── loading_indicator.dart
│       ├── cards/
│       │   ├── playing_card.dart
│       │   ├── card_fan.dart
│       │   └── card_pile.dart
│       ├── game/
│       │   ├── player_hand.dart
│       │   ├── game_table.dart
│       │   ├── score_board.dart
│       │   └── turn_indicator.dart
│       └── lobby/
│           ├── room_code_display.dart
│           ├── player_slot.dart
│           └── team_column.dart
│
├── l10n/
│   ├── app_en.arb
│   └── app_dv.arb
│
└── router/
    └── app_router.dart

assets/
├── images/
│   └── cards/
│       ├── clubs/
│       ├── diamonds/
│       ├── hearts/
│       ├── spades/
│       └── back.png
├── fonts/
│   └── MVAWaheed.ttf
└── audio/
    ├── card_play.mp3
    ├── card_shuffle.mp3
    └── win.mp3
```

---

## 5. Data Models

### Card Model

```dart
// lib/data/models/card.dart

import 'package:freezed_annotation/freezed_annotation.dart';

part 'card.freezed.dart';
part 'card.g.dart';

enum Suit { clubs, diamonds, hearts, spades }

enum Rank {
  ace, two, three, four, five, six, seven,
  eight, nine, ten, jack, queen, king
}

@freezed
class PlayingCard with _$PlayingCard {
  const factory PlayingCard({
    required Suit suit,
    required Rank rank,
  }) = _PlayingCard;

  factory PlayingCard.fromJson(Map<String, dynamic> json) =>
      _$PlayingCardFromJson(json);
}

extension PlayingCardExtension on PlayingCard {
  int get value {
    switch (rank) {
      case Rank.ace:
        return 1;
      case Rank.two:
        return 2;
      case Rank.three:
        return 3;
      case Rank.four:
        return 4;
      case Rank.five:
        return 5;
      case Rank.six:
        return 6;
      case Rank.seven:
        return 7;
      case Rank.eight:
        return 8;
      case Rank.nine:
        return 9;
      case Rank.ten:
      case Rank.jack:
      case Rank.queen:
      case Rank.king:
        return 10;
    }
  }

  int get diguPoints {
    switch (rank) {
      case Rank.ace:
        return 15;
      case Rank.ten:
      case Rank.jack:
      case Rank.queen:
      case Rank.king:
        return 10;
      case Rank.two:
        if (suit == Suit.spades) return 2;
        return 0;
      case Rank.seven:
        if (suit == Suit.diamonds) return 1;
        return 0;
      default:
        return 0;
    }
  }

  String get imagePath => 'assets/images/cards/${suit.name}/${rank.name}.png';
}
```

### Player Model

```dart
// lib/data/models/player.dart

import 'package:freezed_annotation/freezed_annotation.dart';
import 'card.dart';

part 'player.freezed.dart';
part 'player.g.dart';

@freezed
class Player with _$Player {
  const factory Player({
    required String oderId,
    required String name,
    @Default(false) bool ready,
    @Default(true) bool connected,
    @Default([]) List<PlayingCard> hand,
    @Default(0) int score,
    @Default(0) int roundScore,
  }) = _Player;

  factory Player.fromJson(Map<String, dynamic> json) =>
      _$PlayerFromJson(json);
}
```

### Room Model

```dart
// lib/data/models/room.dart

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:freezed_annotation/freezed_annotation.dart';
import 'player.dart';

part 'room.freezed.dart';
part 'room.g.dart';

enum RoomStatus { waiting, playing, finished }
enum GameType { dhihaEi, digu }

@freezed
class Room with _$Room {
  const factory Room({
    required String id,
    required String hostId,
    required GameType gameType,
    required RoomStatus status,
    required int maxPlayers,
    required Map<int, Player> players,
    required DateTime createdAt,
  }) = _Room;

  factory Room.fromJson(Map<String, dynamic> json) =>
      _$RoomFromJson(json);

  factory Room.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>;
    return Room(
      id: doc.id,
      hostId: data['hostId'],
      gameType: GameType.values.byName(data['gameType']),
      status: RoomStatus.values.byName(data['status']),
      maxPlayers: data['maxPlayers'],
      players: (data['players'] as Map<String, dynamic>).map(
        (key, value) => MapEntry(int.parse(key), Player.fromJson(value)),
      ),
      createdAt: (data['createdAt'] as Timestamp).toDate(),
    );
  }
}
```

### Digu Game State

```dart
// lib/data/models/digu_game_state.dart

import 'package:freezed_annotation/freezed_annotation.dart';
import 'card.dart';
import 'meld.dart';

part 'digu_game_state.freezed.dart';
part 'digu_game_state.g.dart';

@freezed
class DiGuGameState with _$DiGuGameState {
  const factory DiGuGameState({
    required int currentTurn,
    required int dealerPosition,
    required List<PlayingCard> stockPile,
    required List<PlayingCard> discardPile,
    required Map<int, List<PlayingCard>> hands,
    required Map<int, List<Meld>> melds,
    required Map<int, int> scores,
    required int roundNumber,
    @Default(false) bool roundOver,
    int? winnerId,
    String? lastAction,
  }) = _DiGuGameState;

  factory DiGuGameState.fromJson(Map<String, dynamic> json) =>
      _$DiGuGameStateFromJson(json);
}

@freezed
class Meld with _$Meld {
  const factory Meld({
    required MeldType type,
    required List<PlayingCard> cards,
  }) = _Meld;

  factory Meld.fromJson(Map<String, dynamic> json) =>
      _$MeldFromJson(json);
}

enum MeldType { set, run }
```

---

## 6. State Management

Using Riverpod for state management:

### Auth Provider

```dart
// lib/presentation/providers/auth_provider.dart

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../data/repositories/auth_repository.dart';

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepository(FirebaseAuth.instance);
});

final authStateProvider = StreamProvider<User?>((ref) {
  return ref.watch(authRepositoryProvider).authStateChanges;
});

final currentUserProvider = Provider<User?>((ref) {
  return ref.watch(authStateProvider).valueOrNull;
});
```

### Room Provider

```dart
// lib/presentation/providers/room_provider.dart

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../data/models/room.dart';
import '../../data/repositories/room_repository.dart';

final roomRepositoryProvider = Provider<RoomRepository>((ref) {
  return RoomRepository();
});

final currentRoomProvider = StateProvider<Room?>((ref) => null);

final roomStreamProvider = StreamProvider.family<Room?, String>((ref, roomId) {
  return ref.watch(roomRepositoryProvider).watchRoom(roomId);
});

class RoomNotifier extends StateNotifier<AsyncValue<Room?>> {
  final RoomRepository _repository;
  final String? _userId;

  RoomNotifier(this._repository, this._userId) : super(const AsyncValue.data(null));

  Future<String> createRoom(GameType gameType, String playerName) async {
    state = const AsyncValue.loading();
    try {
      final roomId = await _repository.createRoom(
        hostId: _userId!,
        gameType: gameType,
        playerName: playerName,
      );
      return roomId;
    } catch (e, st) {
      state = AsyncValue.error(e, st);
      rethrow;
    }
  }

  Future<void> joinRoom(String roomId, String playerName) async {
    state = const AsyncValue.loading();
    try {
      await _repository.joinRoom(
        roomId: roomId,
        userId: _userId!,
        playerName: playerName,
      );
    } catch (e, st) {
      state = AsyncValue.error(e, st);
      rethrow;
    }
  }

  Future<void> leaveRoom(String roomId) async {
    await _repository.leaveRoom(roomId: roomId, userId: _userId!);
    state = const AsyncValue.data(null);
  }

  Future<void> setReady(String roomId, bool ready) async {
    await _repository.setReady(roomId: roomId, userId: _userId!, ready: ready);
  }

  Future<void> swapPlayer(String roomId, int fromPosition) async {
    await _repository.swapPlayer(roomId: roomId, fromPosition: fromPosition);
  }
}

final roomNotifierProvider = StateNotifierProvider<RoomNotifier, AsyncValue<Room?>>((ref) {
  final repository = ref.watch(roomRepositoryProvider);
  final user = ref.watch(currentUserProvider);
  return RoomNotifier(repository, user?.uid);
});
```

### Game Provider

```dart
// lib/presentation/providers/game_provider.dart

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../data/models/digu_game_state.dart';
import '../../data/models/card.dart';
import '../../domain/game_logic/digu_game.dart';

final diGuGameProvider = StateNotifierProvider.family<DiGuGameNotifier, DiGuGameState?, String>(
  (ref, roomId) => DiGuGameNotifier(roomId),
);

class DiGuGameNotifier extends StateNotifier<DiGuGameState?> {
  final String roomId;
  final DiGuGame _gameLogic = DiGuGame();

  DiGuGameNotifier(this.roomId) : super(null);

  void initializeGame(Map<int, String> players) {
    state = _gameLogic.initializeGame(players);
  }

  void drawCard({required int position, required bool fromDiscard}) {
    if (state == null) return;
    state = _gameLogic.drawCard(state!, position: position, fromDiscard: fromDiscard);
  }

  void discardCard({required int position, required PlayingCard card}) {
    if (state == null) return;
    state = _gameLogic.discardCard(state!, position: position, card: card);
  }

  void declareMeld({required int position, required List<PlayingCard> cards}) {
    if (state == null) return;
    state = _gameLogic.declareMeld(state!, position: position, cards: cards);
  }

  void declareWin({required int position}) {
    if (state == null) return;
    state = _gameLogic.declareWin(state!, position: position);
  }
}
```

---

## 7. Authentication

### Auth Repository

```dart
// lib/data/repositories/auth_repository.dart

import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';

class AuthRepository {
  final FirebaseAuth _auth;
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;

  AuthRepository(this._auth);

  Stream<User?> get authStateChanges => _auth.authStateChanges();

  User? get currentUser => _auth.currentUser;

  /// Sign in anonymously for guest players
  Future<UserCredential> signInAnonymously() async {
    final credential = await _auth.signInAnonymously();

    // Create user document
    await _firestore.collection('users').doc(credential.user!.uid).set({
      'displayName': 'Guest',
      'gamesPlayed': 0,
      'gamesWon': 0,
      'createdAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));

    return credential;
  }

  /// Sign in with Google
  Future<UserCredential> signInWithGoogle() async {
    final GoogleAuthProvider googleProvider = GoogleAuthProvider();
    final credential = await _auth.signInWithPopup(googleProvider);

    // Create/update user document
    await _firestore.collection('users').doc(credential.user!.uid).set({
      'displayName': credential.user!.displayName ?? 'Player',
      'email': credential.user!.email,
      'photoUrl': credential.user!.photoURL,
      'lastLogin': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));

    return credential;
  }

  /// Update display name
  Future<void> updateDisplayName(String name) async {
    final user = _auth.currentUser;
    if (user == null) return;

    await user.updateDisplayName(name);
    await _firestore.collection('users').doc(user.uid).update({
      'displayName': name,
    });
  }

  /// Sign out
  Future<void> signOut() async {
    await _auth.signOut();
  }
}
```

### Auth Screen

```dart
// lib/presentation/screens/auth/auth_screen.dart

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/auth_provider.dart';

class AuthScreen extends ConsumerStatefulWidget {
  const AuthScreen({super.key});

  @override
  ConsumerState<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends ConsumerState<AuthScreen> {
  bool _isLoading = false;

  Future<void> _signInAnonymously() async {
    setState(() => _isLoading = true);
    try {
      await ref.read(authRepositoryProvider).signInAnonymously();
    } finally {
      setState(() => _isLoading = false);
    }
  }

  Future<void> _signInWithGoogle() async {
    setState(() => _isLoading = true);
    try {
      await ref.read(authRepositoryProvider).signInWithGoogle();
    } finally {
      setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [Color(0xFF1a4a3a), Color(0xFF0d2d20)],
          ),
        ),
        child: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              // Logo
              Image.asset('assets/images/logo.png', height: 120),
              const SizedBox(height: 48),

              // Title
              const Text(
                'Thaasbai',
                style: TextStyle(
                  fontSize: 48,
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'Maldivian Card Games',
                style: TextStyle(fontSize: 18, color: Colors.white70),
              ),
              const SizedBox(height: 64),

              // Play as Guest
              ElevatedButton(
                onPressed: _isLoading ? null : _signInAnonymously,
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.amber,
                  foregroundColor: Colors.black,
                  padding: const EdgeInsets.symmetric(horizontal: 48, vertical: 16),
                ),
                child: const Text('Play as Guest', style: TextStyle(fontSize: 18)),
              ),
              const SizedBox(height: 16),

              // Sign in with Google
              OutlinedButton.icon(
                onPressed: _isLoading ? null : _signInWithGoogle,
                icon: Image.asset('assets/images/google_logo.png', height: 24),
                label: const Text('Sign in with Google'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: Colors.white,
                  side: const BorderSide(color: Colors.white),
                  padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 12),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
```

---

## 8. Real-time Multiplayer

### Room Repository

```dart
// lib/data/repositories/room_repository.dart

import 'dart:math';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_database/firebase_database.dart';
import '../models/room.dart';
import '../models/player.dart';

class RoomRepository {
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  final FirebaseDatabase _database = FirebaseDatabase.instance;

  /// Generate a 6-character room code
  String _generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    final random = Random.secure();
    return List.generate(6, (_) => chars[random.nextInt(chars.length)]).join();
  }

  /// Create a new room
  Future<String> createRoom({
    required String hostId,
    required GameType gameType,
    required String playerName,
  }) async {
    final roomId = _generateRoomCode();
    final maxPlayers = gameType == GameType.digu ? 4 : 4;

    await _firestore.collection('rooms').doc(roomId).set({
      'hostId': hostId,
      'gameType': gameType.name,
      'status': RoomStatus.waiting.name,
      'maxPlayers': maxPlayers,
      'players': {
        '0': {
          'oderId': hostId,
          'name': playerName,
          'ready': false,
          'connected': true,
        },
      },
      'playerIds': [hostId],
      'createdAt': FieldValue.serverTimestamp(),
    });

    // Set up presence
    await _setupPresence(roomId, hostId, 0);

    return roomId;
  }

  /// Join an existing room
  Future<int> joinRoom({
    required String roomId,
    required String userId,
    required String playerName,
  }) async {
    final roomRef = _firestore.collection('rooms').doc(roomId);

    return _firestore.runTransaction((transaction) async {
      final snapshot = await transaction.get(roomRef);

      if (!snapshot.exists) {
        throw Exception('Room not found');
      }

      final data = snapshot.data()!;
      final status = RoomStatus.values.byName(data['status']);

      if (status != RoomStatus.waiting) {
        throw Exception('Game already in progress');
      }

      final players = Map<String, dynamic>.from(data['players']);
      final maxPlayers = data['maxPlayers'] as int;

      // Find empty slot
      int? position;
      for (int i = 0; i < maxPlayers; i++) {
        if (!players.containsKey(i.toString())) {
          position = i;
          break;
        }
      }

      if (position == null) {
        throw Exception('Room is full');
      }

      // Add player
      players[position.toString()] = {
        'oderId': userId,
        'name': playerName,
        'ready': false,
        'connected': true,
      };

      final playerIds = List<String>.from(data['playerIds'])..add(userId);

      transaction.update(roomRef, {
        'players': players,
        'playerIds': playerIds,
      });

      return position;
    }).then((position) async {
      await _setupPresence(roomId, userId, position);
      return position;
    });
  }

  /// Leave a room
  Future<void> leaveRoom({
    required String roomId,
    required String userId,
  }) async {
    final roomRef = _firestore.collection('rooms').doc(roomId);

    await _firestore.runTransaction((transaction) async {
      final snapshot = await transaction.get(roomRef);

      if (!snapshot.exists) return;

      final data = snapshot.data()!;
      final players = Map<String, dynamic>.from(data['players']);
      final playerIds = List<String>.from(data['playerIds']);

      // Find and remove player
      String? positionToRemove;
      for (final entry in players.entries) {
        if (entry.value['oderId'] == userId) {
          positionToRemove = entry.key;
          break;
        }
      }

      if (positionToRemove != null) {
        players.remove(positionToRemove);
        playerIds.remove(userId);

        if (players.isEmpty) {
          // Delete room if empty
          transaction.delete(roomRef);
        } else {
          // If host left, assign new host
          if (data['hostId'] == userId && playerIds.isNotEmpty) {
            final newHostId = playerIds.first;
            transaction.update(roomRef, {
              'players': players,
              'playerIds': playerIds,
              'hostId': newHostId,
            });
          } else {
            transaction.update(roomRef, {
              'players': players,
              'playerIds': playerIds,
            });
          }
        }
      }
    });

    // Clean up presence
    await _database.ref('presence/$roomId/$userId').remove();
  }

  /// Set player ready status
  Future<void> setReady({
    required String roomId,
    required String userId,
    required bool ready,
  }) async {
    final roomRef = _firestore.collection('rooms').doc(roomId);
    final snapshot = await roomRef.get();

    if (!snapshot.exists) return;

    final players = Map<String, dynamic>.from(snapshot.data()!['players']);

    for (final entry in players.entries) {
      if (entry.value['oderId'] == userId) {
        players[entry.key]['ready'] = ready;
        break;
      }
    }

    await roomRef.update({'players': players});
  }

  /// Swap player to other team (Digu)
  Future<void> swapPlayer({
    required String roomId,
    required int fromPosition,
  }) async {
    final roomRef = _firestore.collection('rooms').doc(roomId);

    await _firestore.runTransaction((transaction) async {
      final snapshot = await transaction.get(roomRef);

      if (!snapshot.exists) return;

      final players = Map<String, dynamic>.from(snapshot.data()!['players']);

      // Team A: 0, 2 | Team B: 1, 3
      final currentTeam = (fromPosition == 0 || fromPosition == 2) ? 0 : 1;
      final targetTeam = currentTeam == 0 ? 1 : 0;
      final targetPositions = targetTeam == 1 ? [1, 3] : [0, 2];

      // Find empty slot on target team
      int? targetPosition;
      for (final pos in targetPositions) {
        if (!players.containsKey(pos.toString())) {
          targetPosition = pos;
          break;
        }
      }

      final playerToMove = players[fromPosition.toString()];

      if (targetPosition != null) {
        // Move to empty slot
        players[targetPosition.toString()] = playerToMove;
        players.remove(fromPosition.toString());
      } else {
        // Swap with first player on target team
        targetPosition = targetPositions.first;
        final playerToSwap = players[targetPosition.toString()];
        players[targetPosition.toString()] = playerToMove;
        players[fromPosition.toString()] = playerToSwap;
      }

      transaction.update(roomRef, {'players': players});
    });
  }

  /// Watch room changes
  Stream<Room?> watchRoom(String roomId) {
    return _firestore
        .collection('rooms')
        .doc(roomId)
        .snapshots()
        .map((snapshot) => snapshot.exists ? Room.fromFirestore(snapshot) : null);
  }

  /// Set up presence tracking
  Future<void> _setupPresence(String roomId, String oderId, int position) async {
    final presenceRef = _database.ref('presence/$roomId/$position');
    final connectedRef = _database.ref('.info/connected');

    connectedRef.onValue.listen((event) {
      if (event.snapshot.value == true) {
        presenceRef.onDisconnect().set({
          'connected': false,
          'lastSeen': ServerValue.timestamp,
        });

        presenceRef.set({
          'connected': true,
          'oderId': oderId,
          'lastSeen': ServerValue.timestamp,
        });
      }
    });
  }
}
```

### Presence Service

```dart
// lib/data/services/presence_service.dart

import 'dart:async';
import 'package:firebase_database/firebase_database.dart';

class PresenceService {
  final FirebaseDatabase _database = FirebaseDatabase.instance;
  StreamSubscription? _presenceSubscription;

  /// Watch presence for a room
  Stream<Map<int, bool>> watchPresence(String roomId) {
    return _database.ref('presence/$roomId').onValue.map((event) {
      final data = event.snapshot.value as Map<dynamic, dynamic>?;
      if (data == null) return {};

      return data.map((key, value) {
        final position = int.parse(key.toString());
        final connected = (value as Map)['connected'] as bool? ?? false;
        return MapEntry(position, connected);
      });
    });
  }

  /// Clean up
  void dispose() {
    _presenceSubscription?.cancel();
  }
}
```

---

## 9. Game Logic Migration

### Digu Game Logic

```dart
// lib/domain/game_logic/digu_game.dart

import 'dart:math';
import '../../data/models/card.dart';
import '../../data/models/digu_game_state.dart';
import '../../data/models/meld.dart';

class DiGuGame {
  final Random _random = Random();

  /// Create a standard 52-card deck
  List<PlayingCard> _createDeck() {
    final deck = <PlayingCard>[];
    for (final suit in Suit.values) {
      for (final rank in Rank.values) {
        deck.add(PlayingCard(suit: suit, rank: rank));
      }
    }
    return deck;
  }

  /// Shuffle the deck
  List<PlayingCard> _shuffleDeck(List<PlayingCard> deck) {
    final shuffled = List<PlayingCard>.from(deck);
    for (int i = shuffled.length - 1; i > 0; i--) {
      final j = _random.nextInt(i + 1);
      final temp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = temp;
    }
    return shuffled;
  }

  /// Initialize a new game
  DiGuGameState initializeGame(Map<int, String> players) {
    final deck = _shuffleDeck(_createDeck());

    // Deal 13 cards to each player
    final hands = <int, List<PlayingCard>>{};
    int cardIndex = 0;

    for (int position = 0; position < 4; position++) {
      hands[position] = deck.sublist(cardIndex, cardIndex + 13);
      cardIndex += 13;
    }

    return DiGuGameState(
      currentTurn: 0,
      dealerPosition: 0,
      stockPile: [],
      discardPile: [],
      hands: hands,
      melds: {0: [], 1: [], 2: [], 3: []},
      scores: {0: 0, 1: 0, 2: 0, 3: 0},
      roundNumber: 1,
    );
  }

  /// Draw a card
  DiGuGameState drawCard(
    DiGuGameState state, {
    required int position,
    required bool fromDiscard,
  }) {
    if (state.currentTurn != position) {
      throw Exception('Not your turn');
    }

    final hands = Map<int, List<PlayingCard>>.from(state.hands);
    final hand = List<PlayingCard>.from(hands[position]!);

    if (fromDiscard) {
      if (state.discardPile.isEmpty) {
        throw Exception('Discard pile is empty');
      }
      final card = state.discardPile.last;
      hand.add(card);
      hands[position] = hand;

      return state.copyWith(
        hands: hands,
        discardPile: state.discardPile.sublist(0, state.discardPile.length - 1),
        lastAction: 'draw_discard',
      );
    } else {
      if (state.stockPile.isEmpty) {
        throw Exception('Stock pile is empty');
      }
      final card = state.stockPile.last;
      hand.add(card);
      hands[position] = hand;

      return state.copyWith(
        hands: hands,
        stockPile: state.stockPile.sublist(0, state.stockPile.length - 1),
        lastAction: 'draw_stock',
      );
    }
  }

  /// Discard a card
  DiGuGameState discardCard(
    DiGuGameState state, {
    required int position,
    required PlayingCard card,
  }) {
    if (state.currentTurn != position) {
      throw Exception('Not your turn');
    }

    final hands = Map<int, List<PlayingCard>>.from(state.hands);
    final hand = List<PlayingCard>.from(hands[position]!);

    final cardIndex = hand.indexWhere(
      (c) => c.suit == card.suit && c.rank == card.rank,
    );

    if (cardIndex == -1) {
      throw Exception('Card not in hand');
    }

    hand.removeAt(cardIndex);
    hands[position] = hand;

    final discardPile = List<PlayingCard>.from(state.discardPile)..add(card);

    // Next turn
    final nextTurn = (position + 1) % 4;

    return state.copyWith(
      hands: hands,
      discardPile: discardPile,
      currentTurn: nextTurn,
      lastAction: 'discard',
    );
  }

  /// Validate a meld (set or run)
  bool validateMeld(List<PlayingCard> cards) {
    if (cards.length < 3) return false;

    // Check for set (same rank, different suits)
    if (_isSet(cards)) return true;

    // Check for run (same suit, consecutive ranks)
    if (_isRun(cards)) return true;

    return false;
  }

  bool _isSet(List<PlayingCard> cards) {
    if (cards.length < 3 || cards.length > 4) return false;

    final rank = cards.first.rank;
    final suits = <Suit>{};

    for (final card in cards) {
      if (card.rank != rank) return false;
      if (suits.contains(card.suit)) return false;
      suits.add(card.suit);
    }

    return true;
  }

  bool _isRun(List<PlayingCard> cards) {
    if (cards.length < 3) return false;

    final suit = cards.first.suit;
    final ranks = cards.map((c) => c.rank.index).toList()..sort();

    for (final card in cards) {
      if (card.suit != suit) return false;
    }

    // Check consecutive
    for (int i = 1; i < ranks.length; i++) {
      if (ranks[i] != ranks[i - 1] + 1) {
        // Check for Ace wrapping (King, Ace, Two)
        if (!(ranks[i - 1] == 12 && ranks[i] == 0)) {
          return false;
        }
      }
    }

    return true;
  }

  /// Declare a meld
  DiGuGameState declareMeld(
    DiGuGameState state, {
    required int position,
    required List<PlayingCard> cards,
  }) {
    if (!validateMeld(cards)) {
      throw Exception('Invalid meld');
    }

    final hands = Map<int, List<PlayingCard>>.from(state.hands);
    final hand = List<PlayingCard>.from(hands[position]!);

    // Remove cards from hand
    for (final card in cards) {
      final index = hand.indexWhere(
        (c) => c.suit == card.suit && c.rank == card.rank,
      );
      if (index == -1) {
        throw Exception('Card not in hand');
      }
      hand.removeAt(index);
    }

    hands[position] = hand;

    // Add meld
    final melds = Map<int, List<Meld>>.from(state.melds);
    final playerMelds = List<Meld>.from(melds[position]!);
    playerMelds.add(Meld(
      type: _isSet(cards) ? MeldType.set : MeldType.run,
      cards: cards,
    ));
    melds[position] = playerMelds;

    return state.copyWith(
      hands: hands,
      melds: melds,
      lastAction: 'meld',
    );
  }

  /// Declare win (Digu)
  DiGuGameState declareWin(DiGuGameState state, {required int position}) {
    final hand = state.hands[position]!;

    // Validate that hand can form valid melds
    if (!_canDeclareWin(hand)) {
      throw Exception('Cannot declare win with current hand');
    }

    // Calculate scores
    final scores = Map<int, int>.from(state.scores);

    // Winner gets points from opponents
    int winnerPoints = 0;
    for (int i = 0; i < 4; i++) {
      if (i != position) {
        final opponentHand = state.hands[i]!;
        final points = _calculateHandPoints(opponentHand);
        winnerPoints += points;
      }
    }

    scores[position] = scores[position]! + winnerPoints;

    return state.copyWith(
      scores: scores,
      roundOver: true,
      winnerId: position,
      lastAction: 'declare_win',
    );
  }

  bool _canDeclareWin(List<PlayingCard> hand) {
    // Implement full validation logic
    // For Digu, check if all cards can form valid melds
    return hand.isEmpty || _validateAllMelds(hand);
  }

  bool _validateAllMelds(List<PlayingCard> cards) {
    // Recursive check if cards can form valid melds
    if (cards.isEmpty) return true;
    if (cards.length < 3) return false;

    // Try to form melds with first card
    // This is a simplified version - full implementation would be more complex
    return true;
  }

  int _calculateHandPoints(List<PlayingCard> hand) {
    return hand.fold(0, (sum, card) => sum + card.diguPoints);
  }
}
```

### AI Player

```dart
// lib/domain/ai/digu_ai.dart

import 'dart:math';
import '../../data/models/card.dart';
import '../../data/models/digu_game_state.dart';
import '../game_logic/digu_game.dart';

enum AIDifficulty { easy, medium, hard }

class DiGuAI {
  final AIDifficulty difficulty;
  final DiGuGame _gameLogic = DiGuGame();
  final Random _random = Random();

  DiGuAI({this.difficulty = AIDifficulty.medium});

  /// Decide which card to draw
  bool shouldDrawFromDiscard(DiGuGameState state, int position) {
    if (state.discardPile.isEmpty) return false;

    final topDiscard = state.discardPile.last;
    final hand = state.hands[position]!;

    switch (difficulty) {
      case AIDifficulty.easy:
        // Random choice
        return _random.nextBool();

      case AIDifficulty.medium:
        // Check if card helps form a meld
        return _cardHelpsFormMeld(topDiscard, hand);

      case AIDifficulty.hard:
        // Advanced strategy
        return _advancedDrawDecision(topDiscard, hand, state);
    }
  }

  /// Decide which card to discard
  PlayingCard chooseDiscard(DiGuGameState state, int position) {
    final hand = state.hands[position]!;

    switch (difficulty) {
      case AIDifficulty.easy:
        // Random discard
        return hand[_random.nextInt(hand.length)];

      case AIDifficulty.medium:
        // Discard least useful card
        return _findLeastUsefulCard(hand);

      case AIDifficulty.hard:
        // Advanced discard strategy
        return _advancedDiscardDecision(hand, state);
    }
  }

  bool _cardHelpsFormMeld(PlayingCard card, List<PlayingCard> hand) {
    // Check if adding this card helps form a set or run
    final sameRank = hand.where((c) => c.rank == card.rank).length;
    if (sameRank >= 2) return true;

    final sameSuit = hand.where((c) => c.suit == card.suit).toList();
    for (final c in sameSuit) {
      final diff = (c.rank.index - card.rank.index).abs();
      if (diff <= 2) return true;
    }

    return false;
  }

  PlayingCard _findLeastUsefulCard(List<PlayingCard> hand) {
    // Score each card by how useful it is
    var leastUseful = hand.first;
    var lowestScore = double.infinity;

    for (final card in hand) {
      final score = _calculateCardUsefulness(card, hand);
      if (score < lowestScore) {
        lowestScore = score;
        leastUseful = card;
      }
    }

    return leastUseful;
  }

  double _calculateCardUsefulness(PlayingCard card, List<PlayingCard> hand) {
    double score = 0;

    // Count same rank cards
    final sameRank = hand.where((c) => c.rank == card.rank && c != card).length;
    score += sameRank * 10;

    // Count potential run cards
    final sameSuit = hand.where((c) => c.suit == card.suit && c != card);
    for (final c in sameSuit) {
      final diff = (c.rank.index - card.rank.index).abs();
      if (diff == 1) score += 8;
      if (diff == 2) score += 4;
    }

    // High point cards are less desirable to keep
    score -= card.diguPoints * 0.5;

    return score;
  }

  bool _advancedDrawDecision(
    PlayingCard topDiscard,
    List<PlayingCard> hand,
    DiGuGameState state,
  ) {
    // Consider what opponents might need
    // Consider game state and scores
    return _cardHelpsFormMeld(topDiscard, hand);
  }

  PlayingCard _advancedDiscardDecision(
    List<PlayingCard> hand,
    DiGuGameState state,
  ) {
    // Consider what cards opponents have discarded
    // Avoid helping opponents
    return _findLeastUsefulCard(hand);
  }
}
```

---

## 10. UI Components

### Game Table Widget

```dart
// lib/presentation/widgets/game/game_table.dart

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../data/models/digu_game_state.dart';
import '../cards/card_pile.dart';
import 'player_area.dart';

class GameTable extends ConsumerWidget {
  final DiGuGameState gameState;
  final int localPosition;
  final Function(bool fromDiscard) onDraw;
  final Function(int cardIndex) onDiscard;

  const GameTable({
    super.key,
    required this.gameState,
    required this.localPosition,
    required this.onDraw,
    required this.onDiscard,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return LayoutBuilder(
      builder: (context, constraints) {
        return Stack(
          children: [
            // Background
            Container(
              decoration: const BoxDecoration(
                gradient: RadialGradient(
                  center: Alignment.center,
                  radius: 0.8,
                  colors: [Color(0xFF1a5a3a), Color(0xFF0d2d20)],
                ),
              ),
            ),

            // Center area (stock and discard piles)
            Center(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  // Stock pile
                  GestureDetector(
                    onTap: gameState.currentTurn == localPosition
                        ? () => onDraw(false)
                        : null,
                    child: CardPile(
                      cards: gameState.stockPile,
                      faceDown: true,
                      label: 'Stock',
                    ),
                  ),
                  const SizedBox(width: 32),
                  // Discard pile
                  GestureDetector(
                    onTap: gameState.currentTurn == localPosition &&
                            gameState.discardPile.isNotEmpty
                        ? () => onDraw(true)
                        : null,
                    child: CardPile(
                      cards: gameState.discardPile,
                      faceDown: false,
                      label: 'Discard',
                    ),
                  ),
                ],
              ),
            ),

            // Player areas
            // Bottom (local player)
            Positioned(
              bottom: 0,
              left: 0,
              right: 0,
              child: PlayerArea(
                position: localPosition,
                player: gameState.hands[localPosition]!,
                isCurrentTurn: gameState.currentTurn == localPosition,
                isLocal: true,
                onCardTap: onDiscard,
              ),
            ),

            // Top (opposite player)
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              child: PlayerArea(
                position: (localPosition + 2) % 4,
                player: gameState.hands[(localPosition + 2) % 4]!,
                isCurrentTurn: gameState.currentTurn == (localPosition + 2) % 4,
                isLocal: false,
              ),
            ),

            // Left player
            Positioned(
              left: 0,
              top: 0,
              bottom: 0,
              child: PlayerArea(
                position: (localPosition + 1) % 4,
                player: gameState.hands[(localPosition + 1) % 4]!,
                isCurrentTurn: gameState.currentTurn == (localPosition + 1) % 4,
                isLocal: false,
                isVertical: true,
              ),
            ),

            // Right player
            Positioned(
              right: 0,
              top: 0,
              bottom: 0,
              child: PlayerArea(
                position: (localPosition + 3) % 4,
                player: gameState.hands[(localPosition + 3) % 4]!,
                isCurrentTurn: gameState.currentTurn == (localPosition + 3) % 4,
                isLocal: false,
                isVertical: true,
              ),
            ),

            // Turn indicator
            if (gameState.currentTurn == localPosition)
              const Positioned(
                bottom: 200,
                left: 0,
                right: 0,
                child: Center(
                  child: Text(
                    'Your Turn',
                    style: TextStyle(
                      color: Colors.amber,
                      fontSize: 24,
                      fontWeight: FontWeight.bold,
                      shadows: [
                        Shadow(blurRadius: 10, color: Colors.black),
                      ],
                    ),
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}
```

### Playing Card Widget

```dart
// lib/presentation/widgets/cards/playing_card.dart

import 'package:flutter/material.dart';
import '../../../data/models/card.dart';

class PlayingCardWidget extends StatelessWidget {
  final PlayingCard card;
  final bool faceDown;
  final bool selected;
  final bool draggable;
  final VoidCallback? onTap;
  final double width;
  final double height;

  const PlayingCardWidget({
    super.key,
    required this.card,
    this.faceDown = false,
    this.selected = false,
    this.draggable = false,
    this.onTap,
    this.width = 70,
    this.height = 100,
  });

  Color get _suitColor {
    switch (card.suit) {
      case Suit.hearts:
      case Suit.diamonds:
        return Colors.red;
      case Suit.clubs:
      case Suit.spades:
        return Colors.black;
    }
  }

  String get _suitSymbol {
    switch (card.suit) {
      case Suit.hearts:
        return '♥';
      case Suit.diamonds:
        return '♦';
      case Suit.clubs:
        return '♣';
      case Suit.spades:
        return '♠';
    }
  }

  String get _rankDisplay {
    switch (card.rank) {
      case Rank.ace:
        return 'A';
      case Rank.jack:
        return 'J';
      case Rank.queen:
        return 'Q';
      case Rank.king:
        return 'K';
      default:
        return (card.rank.index + 1).toString();
    }
  }

  @override
  Widget build(BuildContext context) {
    Widget cardWidget = AnimatedContainer(
      duration: const Duration(milliseconds: 200),
      width: width,
      height: height,
      transform: Matrix4.translationValues(0, selected ? -15 : 0, 0),
      decoration: BoxDecoration(
        color: faceDown ? const Color(0xFF1a4a3a) : Colors.white,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: selected ? Colors.amber : Colors.grey.shade300,
          width: selected ? 3 : 1,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.3),
            blurRadius: 4,
            offset: const Offset(2, 2),
          ),
        ],
      ),
      child: faceDown
          ? _buildCardBack()
          : _buildCardFace(),
    );

    if (onTap != null) {
      cardWidget = GestureDetector(
        onTap: onTap,
        child: cardWidget,
      );
    }

    if (draggable) {
      cardWidget = Draggable<PlayingCard>(
        data: card,
        feedback: Transform.scale(
          scale: 1.1,
          child: cardWidget,
        ),
        childWhenDragging: Opacity(
          opacity: 0.5,
          child: cardWidget,
        ),
        child: cardWidget,
      );
    }

    return cardWidget;
  }

  Widget _buildCardBack() {
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(8),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF2a6a4a), Color(0xFF1a4a3a)],
        ),
      ),
      child: Center(
        child: Icon(
          Icons.catching_pokemon,
          color: Colors.white.withOpacity(0.3),
          size: 40,
        ),
      ),
    );
  }

  Widget _buildCardFace() {
    return Padding(
      padding: const EdgeInsets.all(4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            _rankDisplay,
            style: TextStyle(
              color: _suitColor,
              fontSize: 16,
              fontWeight: FontWeight.bold,
            ),
          ),
          Text(
            _suitSymbol,
            style: TextStyle(
              color: _suitColor,
              fontSize: 14,
            ),
          ),
          const Spacer(),
          Center(
            child: Text(
              _suitSymbol,
              style: TextStyle(
                color: _suitColor,
                fontSize: 32,
              ),
            ),
          ),
          const Spacer(),
          Align(
            alignment: Alignment.bottomRight,
            child: Transform.rotate(
              angle: 3.14159,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _rankDisplay,
                    style: TextStyle(
                      color: _suitColor,
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  Text(
                    _suitSymbol,
                    style: TextStyle(
                      color: _suitColor,
                      fontSize: 14,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
```

### Player Hand Widget

```dart
// lib/presentation/widgets/cards/player_hand.dart

import 'package:flutter/material.dart';
import '../../../data/models/card.dart';
import 'playing_card.dart';

class PlayerHand extends StatefulWidget {
  final List<PlayingCard> cards;
  final bool isLocal;
  final Set<int> selectedIndices;
  final Function(int)? onCardTap;
  final Function(List<int>)? onSelectionChanged;

  const PlayerHand({
    super.key,
    required this.cards,
    required this.isLocal,
    this.selectedIndices = const {},
    this.onCardTap,
    this.onSelectionChanged,
  });

  @override
  State<PlayerHand> createState() => _PlayerHandState();
}

class _PlayerHandState extends State<PlayerHand> {
  Set<int> _selectedIndices = {};

  @override
  void initState() {
    super.initState();
    _selectedIndices = Set.from(widget.selectedIndices);
  }

  void _toggleSelection(int index) {
    setState(() {
      if (_selectedIndices.contains(index)) {
        _selectedIndices.remove(index);
      } else {
        _selectedIndices.add(index);
      }
    });
    widget.onSelectionChanged?.call(_selectedIndices.toList());
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final cardCount = widget.cards.length;
        final maxWidth = constraints.maxWidth;

        // Calculate overlap
        const cardWidth = 70.0;
        final totalWidth = cardWidth * cardCount;
        final overlap = totalWidth > maxWidth
            ? (totalWidth - maxWidth) / (cardCount - 1)
            : 0.0;

        return SizedBox(
          height: 120,
          child: Stack(
            alignment: Alignment.center,
            children: List.generate(cardCount, (index) {
              final offset = index * (cardWidth - overlap);

              return Positioned(
                left: offset,
                child: PlayingCardWidget(
                  card: widget.cards[index],
                  faceDown: !widget.isLocal,
                  selected: _selectedIndices.contains(index),
                  onTap: widget.isLocal
                      ? () {
                          if (widget.onCardTap != null) {
                            widget.onCardTap!(index);
                          } else {
                            _toggleSelection(index);
                          }
                        }
                      : null,
                ),
              );
            }),
          ),
        );
      },
    );
  }
}
```

---

## 11. Card Rendering

### SVG Card Assets

For better quality, use SVG cards:

```dart
// lib/presentation/widgets/cards/svg_playing_card.dart

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import '../../../data/models/card.dart';

class SvgPlayingCard extends StatelessWidget {
  final PlayingCard card;
  final bool faceDown;
  final double width;
  final double height;

  const SvgPlayingCard({
    super.key,
    required this.card,
    this.faceDown = false,
    this.width = 70,
    this.height = 100,
  });

  String get _assetPath {
    if (faceDown) {
      return 'assets/cards/back.svg';
    }

    final suitName = card.suit.name;
    final rankName = _getRankName();
    return 'assets/cards/$suitName/$rankName.svg';
  }

  String _getRankName() {
    switch (card.rank) {
      case Rank.ace:
        return 'ace';
      case Rank.jack:
        return 'jack';
      case Rank.queen:
        return 'queen';
      case Rank.king:
        return 'king';
      default:
        return (card.rank.index + 1).toString();
    }
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: width,
      height: height,
      child: SvgPicture.asset(
        _assetPath,
        fit: BoxFit.contain,
      ),
    );
  }
}
```

---

## 12. Animations

### Card Animation Controller

```dart
// lib/presentation/widgets/cards/animated_card.dart

import 'package:flutter/material.dart';
import '../../../data/models/card.dart';
import 'playing_card.dart';

class AnimatedCard extends StatefulWidget {
  final PlayingCard card;
  final Offset startPosition;
  final Offset endPosition;
  final bool flipCard;
  final VoidCallback? onComplete;

  const AnimatedCard({
    super.key,
    required this.card,
    required this.startPosition,
    required this.endPosition,
    this.flipCard = false,
    this.onComplete,
  });

  @override
  State<AnimatedCard> createState() => _AnimatedCardState();
}

class _AnimatedCardState extends State<AnimatedCard>
    with TickerProviderStateMixin {
  late AnimationController _moveController;
  late AnimationController _flipController;
  late Animation<Offset> _moveAnimation;
  late Animation<double> _flipAnimation;

  @override
  void initState() {
    super.initState();

    _moveController = AnimationController(
      duration: const Duration(milliseconds: 500),
      vsync: this,
    );

    _flipController = AnimationController(
      duration: const Duration(milliseconds: 300),
      vsync: this,
    );

    _moveAnimation = Tween<Offset>(
      begin: widget.startPosition,
      end: widget.endPosition,
    ).animate(CurvedAnimation(
      parent: _moveController,
      curve: Curves.easeOutCubic,
    ));

    _flipAnimation = Tween<double>(
      begin: 0,
      end: 1,
    ).animate(CurvedAnimation(
      parent: _flipController,
      curve: Curves.easeInOut,
    ));

    _startAnimation();
  }

  void _startAnimation() async {
    await _moveController.forward();
    if (widget.flipCard) {
      await _flipController.forward();
    }
    widget.onComplete?.call();
  }

  @override
  void dispose() {
    _moveController.dispose();
    _flipController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: Listenable.merge([_moveController, _flipController]),
      builder: (context, child) {
        final flipValue = _flipAnimation.value;
        final isFaceUp = flipValue > 0.5;

        return Positioned(
          left: _moveAnimation.value.dx,
          top: _moveAnimation.value.dy,
          child: Transform(
            alignment: Alignment.center,
            transform: Matrix4.identity()
              ..setEntry(3, 2, 0.001)
              ..rotateY(flipValue * 3.14159),
            child: PlayingCardWidget(
              card: widget.card,
              faceDown: widget.flipCard ? !isFaceUp : true,
            ),
          ),
        );
      },
    );
  }
}
```

---

## 13. Localization

### ARB Files

```json
// lib/l10n/app_en.arb
{
  "@@locale": "en",
  "appTitle": "Thaasbai",
  "homeTitle": "Maldivian Card Games",
  "playVsAI": "Play vs AI",
  "quickMatch": "Quick Match",
  "createRoom": "Create Room",
  "joinRoom": "Join Room",
  "roomCode": "Room Code",
  "enterRoomCode": "Enter 6-letter code",
  "waiting": "Waiting...",
  "ready": "Ready",
  "startGame": "Start Game",
  "yourTurn": "Your Turn",
  "teamA": "Team A",
  "teamB": "Team B",
  "score": "Score",
  "round": "Round {number}",
  "@round": {
    "placeholders": {
      "number": {"type": "int"}
    }
  },
  "playerWins": "{name} wins!",
  "@playerWins": {
    "placeholders": {
      "name": {"type": "String"}
    }
  }
}
```

```json
// lib/l10n/app_dv.arb
{
  "@@locale": "dv",
  "appTitle": "ތާސްބައި",
  "homeTitle": "ދިވެހި ކާޑު ގޭމްތައް",
  "playVsAI": "AI އާ އެކު ކުޅުއް",
  "quickMatch": "ކުއިކް މެޗް",
  "createRoom": "ރޫމް ހަދާ",
  "joinRoom": "ރޫމަށް ވަދޭ",
  "roomCode": "ރޫމް ކޯޑް",
  "enterRoomCode": "6 އަކުރުގެ ކޯޑް ޖައްސާ",
  "waiting": "މަޑުކުރަނީ...",
  "ready": "ތައްޔާރު",
  "startGame": "ގޭމް ފައްޓާ",
  "yourTurn": "ތިބާގެ ފަހަރު",
  "teamA": "ޓީމް A",
  "teamB": "ޓީމް B",
  "score": "ޕޮއިންޓް",
  "round": "ބުރު {number}",
  "playerWins": "{name} މޮޅުވީ!"
}
```

### Localization Setup

```dart
// lib/l10n/l10n.dart

import 'package:flutter/material.dart';
import 'package:flutter_gen/gen_l10n/app_localizations.dart';

extension LocalizationExtension on BuildContext {
  AppLocalizations get l10n => AppLocalizations.of(this)!;
}
```

---

## 14. Platform-Specific Considerations

### Web

```dart
// lib/core/platform/web_utils.dart

import 'package:flutter/foundation.dart';

class WebUtils {
  static bool get isWeb => kIsWeb;

  static void preventContextMenu() {
    if (kIsWeb) {
      // Prevent right-click context menu
      // Use js interop if needed
    }
  }

  static void setMetaTags() {
    if (kIsWeb) {
      // Set PWA meta tags dynamically
    }
  }
}
```

### iOS

```xml
<!-- ios/Runner/Info.plist -->
<key>UIBackgroundModes</key>
<array>
  <string>fetch</string>
  <string>remote-notification</string>
</array>

<!-- Game Center support (optional) -->
<key>GCSupportsGameCenter</key>
<true/>
```

### Android

```xml
<!-- android/app/src/main/AndroidManifest.xml -->
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.VIBRATE"/>

<!-- Keep screen on during gameplay -->
<uses-permission android:name="android.permission.WAKE_LOCK"/>
```

### Responsive Design

```dart
// lib/core/utils/responsive_utils.dart

import 'package:flutter/material.dart';

enum DeviceType { mobile, tablet, desktop }

class ResponsiveUtils {
  static DeviceType getDeviceType(BuildContext context) {
    final width = MediaQuery.of(context).size.width;

    if (width < 600) return DeviceType.mobile;
    if (width < 1200) return DeviceType.tablet;
    return DeviceType.desktop;
  }

  static double getCardWidth(BuildContext context) {
    switch (getDeviceType(context)) {
      case DeviceType.mobile:
        return 60;
      case DeviceType.tablet:
        return 80;
      case DeviceType.desktop:
        return 100;
    }
  }

  static EdgeInsets getTablePadding(BuildContext context) {
    switch (getDeviceType(context)) {
      case DeviceType.mobile:
        return const EdgeInsets.all(8);
      case DeviceType.tablet:
        return const EdgeInsets.all(16);
      case DeviceType.desktop:
        return const EdgeInsets.all(32);
    }
  }
}
```

---

## 15. Testing

### Unit Tests

```dart
// test/domain/game_logic/digu_game_test.dart

import 'package:flutter_test/flutter_test.dart';
import 'package:thaasbai/data/models/card.dart';
import 'package:thaasbai/domain/game_logic/digu_game.dart';

void main() {
  late DiGuGame game;

  setUp(() {
    game = DiGuGame();
  });

  group('Meld Validation', () {
    test('validates a set of three cards', () {
      final cards = [
        const PlayingCard(suit: Suit.hearts, rank: Rank.king),
        const PlayingCard(suit: Suit.diamonds, rank: Rank.king),
        const PlayingCard(suit: Suit.clubs, rank: Rank.king),
      ];

      expect(game.validateMeld(cards), isTrue);
    });

    test('validates a run of three cards', () {
      final cards = [
        const PlayingCard(suit: Suit.hearts, rank: Rank.five),
        const PlayingCard(suit: Suit.hearts, rank: Rank.six),
        const PlayingCard(suit: Suit.hearts, rank: Rank.seven),
      ];

      expect(game.validateMeld(cards), isTrue);
    });

    test('rejects invalid meld', () {
      final cards = [
        const PlayingCard(suit: Suit.hearts, rank: Rank.five),
        const PlayingCard(suit: Suit.diamonds, rank: Rank.six),
        const PlayingCard(suit: Suit.clubs, rank: Rank.seven),
      ];

      expect(game.validateMeld(cards), isFalse);
    });
  });

  group('Game Initialization', () {
    test('deals 13 cards to each player', () {
      final state = game.initializeGame({
        0: 'Player 1',
        1: 'Player 2',
        2: 'Player 3',
        3: 'Player 4',
      });

      expect(state.hands[0]!.length, equals(13));
      expect(state.hands[1]!.length, equals(13));
      expect(state.hands[2]!.length, equals(13));
      expect(state.hands[3]!.length, equals(13));
    });
  });
}
```

### Widget Tests

```dart
// test/presentation/widgets/playing_card_test.dart

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:thaasbai/data/models/card.dart';
import 'package:thaasbai/presentation/widgets/cards/playing_card.dart';

void main() {
  testWidgets('PlayingCard displays correct rank and suit', (tester) async {
    const card = PlayingCard(suit: Suit.hearts, rank: Rank.ace);

    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: PlayingCardWidget(card: card),
        ),
      ),
    );

    expect(find.text('A'), findsWidgets);
    expect(find.text('♥'), findsWidgets);
  });

  testWidgets('PlayingCard shows back when faceDown', (tester) async {
    const card = PlayingCard(suit: Suit.hearts, rank: Rank.ace);

    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: PlayingCardWidget(card: card, faceDown: true),
        ),
      ),
    );

    expect(find.text('A'), findsNothing);
    expect(find.text('♥'), findsNothing);
  });
}
```

### Integration Tests

```dart
// integration_test/game_flow_test.dart

import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:thaasbai/main.dart' as app;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('Complete game flow', (tester) async {
    app.main();
    await tester.pumpAndSettle();

    // Sign in as guest
    await tester.tap(find.text('Play as Guest'));
    await tester.pumpAndSettle();

    // Select Digu
    await tester.tap(find.text('Digu'));
    await tester.pumpAndSettle();

    // Play vs AI
    await tester.tap(find.text('Play vs AI'));
    await tester.pumpAndSettle();

    // Verify game started
    expect(find.text('Your Turn'), findsOneWidget);
  });
}
```

---

## 16. Deployment

### Web Deployment

```bash
# Build for web
flutter build web --release

# Deploy to Firebase Hosting
firebase deploy --only hosting
```

### iOS Deployment

```bash
# Build for iOS
flutter build ios --release

# Open Xcode for App Store upload
open ios/Runner.xcworkspace
```

### Android Deployment

```bash
# Build APK
flutter build apk --release

# Build App Bundle for Play Store
flutter build appbundle --release
```

### Firebase Hosting Configuration

```json
// firebase.json
{
  "hosting": {
    "public": "build/web",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [
      {
        "source": "**",
        "destination": "/index.html"
      }
    ],
    "headers": [
      {
        "source": "**/*.@(js|css)",
        "headers": [
          {
            "key": "Cache-Control",
            "value": "max-age=31536000"
          }
        ]
      }
    ]
  }
}
```

---

## 17. Migration Checklist

### Phase 1: Setup
- [ ] Create Flutter project
- [ ] Set up Firebase project
- [ ] Configure FlutterFire
- [ ] Set up project structure
- [ ] Add dependencies

### Phase 2: Core Features
- [ ] Implement data models
- [ ] Set up state management (Riverpod)
- [ ] Implement authentication
- [ ] Set up Firestore collections
- [ ] Set up Realtime Database for presence

### Phase 3: Game Logic
- [ ] Port card deck logic
- [ ] Port meld validation (Digu)
- [ ] Port trick-taking logic (Dhiha Ei)
- [ ] Port scoring logic
- [ ] Implement AI players

### Phase 4: UI
- [ ] Create theme and colors
- [ ] Build card widgets
- [ ] Build game table layout
- [ ] Build lobby screens
- [ ] Build waiting room
- [ ] Add animations

### Phase 5: Multiplayer
- [ ] Implement room creation
- [ ] Implement room joining
- [ ] Implement team assignment
- [ ] Implement real-time game sync
- [ ] Implement presence tracking
- [ ] Add matchmaking

### Phase 6: Polish
- [ ] Add localization (EN/DV)
- [ ] Add sound effects
- [ ] Add haptic feedback
- [ ] Optimize performance
- [ ] Test on all platforms

### Phase 7: Deployment
- [ ] Configure web hosting
- [ ] Submit to App Store
- [ ] Submit to Play Store
- [ ] Set up monitoring

---

## Resources

- [Flutter Documentation](https://docs.flutter.dev/)
- [Firebase Documentation](https://firebase.google.com/docs)
- [FlutterFire Documentation](https://firebase.flutter.dev/)
- [Riverpod Documentation](https://riverpod.dev/)
- [Freezed Package](https://pub.dev/packages/freezed)

---

*Document Version: 1.0*
*Last Updated: February 2026*
