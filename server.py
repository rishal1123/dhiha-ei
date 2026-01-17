"""
Thaasbai - Multiplayer Game Server
Python WebSocket server using Flask-SocketIO
Supports: Dhiha Ei, Digu (coming soon)
"""

import os
import random
import string
import time
import threading
from flask import Flask, send_from_directory
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# In-memory storage for rooms and players
rooms = {}
player_sessions = {}  # Maps session ID to room and position
matchmaking_queue = []  # List of {sid, name, joinedAt}

def generate_room_code():
    """Generate a 6-character room code"""
    chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    while True:
        code = ''.join(random.choice(chars) for _ in range(6))
        if code not in rooms:
            return code

def get_room_state(room_id):
    """Get serializable room state"""
    if room_id not in rooms:
        return None
    room = rooms[room_id]
    return {
        'roomId': room_id,
        'metadata': room['metadata'],
        'players': room['players'],
        'gameState': room.get('gameState'),
        'hands': room.get('hands')
    }

# Serve static files
@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('.', path)

# WebSocket Events

@socketio.on('connect')
def handle_connect():
    print(f'Client connected: {request.sid}')
    emit('connected', {'sid': request.sid})

@socketio.on('disconnect')
def handle_disconnect():
    sid = request.sid
    print(f'Client disconnected: {sid}')

    # Remove from matchmaking queue if present
    global matchmaking_queue
    was_in_queue = any(p['sid'] == sid for p in matchmaking_queue)
    matchmaking_queue = [p for p in matchmaking_queue if p['sid'] != sid]
    if was_in_queue:
        print(f'Removed disconnected player from queue. Queue size: {len(matchmaking_queue)}')
        # Update remaining players in queue
        for player in matchmaking_queue:
            socketio.emit('queue_update', {
                'playersInQueue': len(matchmaking_queue),
                'playersNeeded': 4 - len(matchmaking_queue)
            }, to=player['sid'])

    # Clean up player from room
    if sid in player_sessions:
        session = player_sessions[sid]
        room_id = session['roomId']
        position = session['position']

        if room_id in rooms:
            room = rooms[room_id]

            if position in room['players']:
                # Mark player as disconnected or remove
                if room['metadata']['status'] == 'playing':
                    # During game, mark as disconnected
                    room['players'][position]['connected'] = False
                    emit('player_disconnected', {
                        'position': position,
                        'players': room['players']
                    }, room=room_id)
                else:
                    # In lobby, remove player
                    del room['players'][position]
                    room['metadata']['playerCount'] = len(room['players'])

                    # Delete room if empty
                    if len(room['players']) == 0:
                        del rooms[room_id]
                        print(f'Room {room_id} deleted (empty)')
                    else:
                        emit('players_changed', {'players': room['players']}, room=room_id)

        del player_sessions[sid]

@socketio.on('create_room')
def handle_create_room(data):
    sid = request.sid
    player_name = data.get('playerName', 'Player')

    room_id = generate_room_code()

    rooms[room_id] = {
        'metadata': {
            'host': sid,
            'created': time.time(),
            'status': 'waiting',
            'playerCount': 1
        },
        'players': {
            0: {
                'oderId': sid,
                'name': player_name,
                'ready': False,
                'connected': True
            }
        },
        'gameState': None,
        'hands': None
    }

    player_sessions[sid] = {
        'roomId': room_id,
        'position': 0
    }

    join_room(room_id)

    print(f'Room {room_id} created by {player_name}')

    emit('room_created', {
        'roomId': room_id,
        'position': 0,
        'players': rooms[room_id]['players']
    })

@socketio.on('join_room')
def handle_join_room(data):
    sid = request.sid
    room_id = data.get('roomId', '').upper().strip()
    player_name = data.get('playerName', 'Player')

    if room_id not in rooms:
        emit('error', {'message': 'Room not found'})
        return

    room = rooms[room_id]

    if room['metadata']['status'] != 'waiting':
        emit('error', {'message': 'Game already in progress'})
        return

    # Find empty slot
    position = None
    for i in range(4):
        if i not in room['players']:
            position = i
            break

    if position is None:
        emit('error', {'message': 'Room is full'})
        return

    # Add player
    room['players'][position] = {
        'oderId': sid,
        'name': player_name,
        'ready': False,
        'connected': True
    }
    room['metadata']['playerCount'] = len(room['players'])

    player_sessions[sid] = {
        'roomId': room_id,
        'position': position
    }

    join_room(room_id)

    print(f'{player_name} joined room {room_id} at position {position}')

    # Notify the joining player
    emit('room_joined', {
        'roomId': room_id,
        'position': position,
        'players': room['players']
    })

    # Notify others in room
    emit('players_changed', {'players': room['players']}, room=room_id, include_self=False)

@socketio.on('leave_room')
def handle_leave_room():
    sid = request.sid

    if sid not in player_sessions:
        return

    session = player_sessions[sid]
    room_id = session['roomId']
    position = session['position']

    if room_id in rooms:
        room = rooms[room_id]

        if position in room['players']:
            del room['players'][position]
            room['metadata']['playerCount'] = len(room['players'])

        leave_room(room_id)

        # Delete room if empty
        if len(room['players']) == 0:
            del rooms[room_id]
            print(f'Room {room_id} deleted (empty)')
        else:
            emit('players_changed', {'players': room['players']}, room=room_id)

    del player_sessions[sid]
    emit('left_room', {})

@socketio.on('set_ready')
def handle_set_ready(data):
    sid = request.sid
    ready = data.get('ready', False)

    if sid not in player_sessions:
        return

    session = player_sessions[sid]
    room_id = session['roomId']
    position = session['position']

    if room_id in rooms and position in rooms[room_id]['players']:
        rooms[room_id]['players'][position]['ready'] = ready
        emit('players_changed', {'players': rooms[room_id]['players']}, room=room_id)

@socketio.on('swap_player')
def handle_swap_player(data):
    sid = request.sid
    from_position = data.get('fromPosition')

    if sid not in player_sessions:
        return

    session = player_sessions[sid]
    room_id = session['roomId']

    # Only host (position 0) can swap
    if session['position'] != 0:
        emit('error', {'message': 'Only host can assign teams'})
        return

    if room_id not in rooms:
        return

    room = rooms[room_id]
    players = room['players']

    if from_position not in players:
        emit('error', {'message': 'No player in that position'})
        return

    # Determine teams
    # Team A: positions 0, 2 | Team B: positions 1, 3
    current_team = 0 if from_position in [0, 2] else 1
    target_team = 1 if current_team == 0 else 0
    target_positions = [1, 3] if target_team == 1 else [0, 2]

    # Find empty slot on target team
    target_position = None
    for pos in target_positions:
        if pos not in players:
            target_position = pos
            break

    player_to_move = players[from_position]

    if target_position is not None:
        # Move to empty slot
        players[target_position] = player_to_move
        del players[from_position]

        # Update session for moved player
        for sess_id, sess in player_sessions.items():
            if sess['roomId'] == room_id and sess['position'] == from_position:
                sess['position'] = target_position
                break
    else:
        # Swap with first player on target team
        target_position = target_positions[0]
        player_to_swap = players[target_position]

        players[target_position] = player_to_move
        players[from_position] = player_to_swap

        # Update sessions for both players
        for sess_id, sess in player_sessions.items():
            if sess['roomId'] == room_id:
                if sess['position'] == from_position:
                    sess['position'] = target_position
                elif sess['position'] == target_position:
                    sess['position'] = from_position

    emit('players_changed', {'players': players}, room=room_id)

    # Notify affected players of their new positions
    emit('position_changed', {
        'fromPosition': from_position,
        'toPosition': target_position,
        'players': players
    }, room=room_id)

@socketio.on('start_game')
def handle_start_game(data):
    sid = request.sid

    if sid not in player_sessions:
        return

    session = player_sessions[sid]
    room_id = session['roomId']

    # Only host can start
    if session['position'] != 0:
        emit('error', {'message': 'Only host can start the game'})
        return

    if room_id not in rooms:
        return

    room = rooms[room_id]

    # Verify 4 players and all ready
    if len(room['players']) != 4:
        emit('error', {'message': 'Need 4 players to start'})
        return

    all_ready = all(p.get('ready', False) for p in room['players'].values())
    if not all_ready:
        emit('error', {'message': 'All players must be ready'})
        return

    # Set game state
    room['metadata']['status'] = 'playing'
    room['gameState'] = data.get('gameState', {})
    room['hands'] = data.get('hands', {})

    print(f'Game started in room {room_id}')

    emit('game_started', {
        'gameState': room['gameState'],
        'hands': room['hands'],
        'players': room['players']
    }, room=room_id)

@socketio.on('card_played')
def handle_card_played(data):
    sid = request.sid

    if sid not in player_sessions:
        return

    session = player_sessions[sid]
    room_id = session['roomId']
    position = session['position']

    card = data.get('card')

    print(f'Card played in room {room_id}: {card} by position {position}')

    # Broadcast to all other players in room
    emit('remote_card_played', {
        'card': card,
        'position': position
    }, room=room_id, include_self=False)

@socketio.on('update_game_state')
def handle_update_game_state(data):
    sid = request.sid

    if sid not in player_sessions:
        return

    session = player_sessions[sid]
    room_id = session['roomId']

    if room_id in rooms:
        rooms[room_id]['gameState'] = data.get('gameState', {})

        emit('game_state_updated', {
            'gameState': rooms[room_id]['gameState']
        }, room=room_id, include_self=False)

@socketio.on('new_round')
def handle_new_round(data):
    sid = request.sid

    if sid not in player_sessions:
        return

    session = player_sessions[sid]
    room_id = session['roomId']

    # Only host broadcasts new rounds
    if session['position'] != 0:
        return

    if room_id in rooms:
        rooms[room_id]['gameState'] = data.get('gameState', {})
        rooms[room_id]['hands'] = data.get('hands', {})

        print(f'New round started in room {room_id}')

        emit('round_started', {
            'gameState': rooms[room_id]['gameState'],
            'hands': rooms[room_id]['hands']
        }, room=room_id)

@socketio.on('ready_for_round')
def handle_ready_for_round():
    """Handle player ready for next round"""
    sid = request.sid

    if sid not in player_sessions:
        return

    session = player_sessions[sid]
    room_id = session['roomId']
    position = session['position']

    if room_id not in rooms:
        return

    room = rooms[room_id]

    # Initialize ready_for_round tracking if not exists
    if 'readyForRound' not in room:
        room['readyForRound'] = {}

    # Mark this player as ready
    room['readyForRound'][position] = True

    print(f'Player {position} ready for next round in room {room_id}')

    # Check if all 4 players are ready
    ready_count = sum(1 for p in room['readyForRound'].values() if p)
    if ready_count >= 4:
        print(f'All players ready for next round in room {room_id}')
        # Reset ready states for next time
        room['readyForRound'] = {}
        # Notify all players
        emit('all_ready_for_round', {}, room=room_id)

# ===========================================
# MATCHMAKING / QUICK MATCH
# ===========================================

def remove_from_queue(sid):
    """Remove a player from the matchmaking queue"""
    global matchmaking_queue
    matchmaking_queue = [p for p in matchmaking_queue if p['sid'] != sid]

# Track active match timeouts
match_timeouts = {}

def check_and_start_match():
    """Check if we have 4 players and start a match"""
    global matchmaking_queue

    if len(matchmaking_queue) >= 4:
        # Take first 4 players
        match_players = matchmaking_queue[:4]
        matchmaking_queue = matchmaking_queue[4:]

        # Create a new room for this match
        room_id = generate_room_code()

        rooms[room_id] = {
            'metadata': {
                'host': match_players[0]['sid'],
                'created': time.time(),
                'status': 'confirming',  # New status for confirmation phase
                'playerCount': 4,
                'isQuickMatch': True,
                'confirmDeadline': time.time() + 30  # 30 second deadline
            },
            'players': {},
            'gameState': None,
            'hands': None
        }

        # Assign players to positions (0, 2 = Team A, 1, 3 = Team B)
        positions = [0, 1, 2, 3]
        random.shuffle(positions)  # Randomize team assignment

        for i, player in enumerate(match_players):
            position = positions[i]
            rooms[room_id]['players'][position] = {
                'oderId': player['sid'],
                'name': player['name'],
                'ready': False,  # Require confirmation
                'connected': True,
                'confirmed': False
            }

            player_sessions[player['sid']] = {
                'roomId': room_id,
                'position': position
            }

            # Add player to socket room
            join_room(room_id, sid=player['sid'])

        print(f'Quick match created: Room {room_id} with players {[p["name"] for p in match_players]} - awaiting confirmation')

        # Notify all matched players - they have 30 seconds to confirm
        for i, player in enumerate(match_players):
            position = player_sessions[player['sid']]['position']
            socketio.emit('match_found', {
                'roomId': room_id,
                'position': position,
                'players': rooms[room_id]['players'],
                'confirmTimeout': 30,
                'requiresConfirmation': True
            }, to=player['sid'])

        # Set up 30-second timeout
        def handle_confirmation_timeout():
            if room_id in rooms:
                room = rooms[room_id]
                if room['metadata']['status'] == 'confirming':
                    # Check who didn't confirm
                    unconfirmed = []
                    confirmed = []
                    for pos, player in room['players'].items():
                        if not player.get('confirmed', False):
                            unconfirmed.append((pos, player))
                        else:
                            confirmed.append((pos, player))

                    print(f'Match {room_id} timeout: {len(unconfirmed)} players did not confirm')

                    # Notify unconfirmed players they were removed
                    for pos, player in unconfirmed:
                        socketio.emit('match_timeout', {
                            'message': 'You did not confirm in time'
                        }, to=player['oderId'])
                        # Clean up session
                        if player['oderId'] in player_sessions:
                            del player_sessions[player['oderId']]
                        leave_room(room_id, sid=player['oderId'])

                    # Put confirmed players back in queue
                    for pos, player in confirmed:
                        socketio.emit('match_cancelled', {
                            'message': 'Match cancelled - some players did not confirm',
                            'requeued': True
                        }, to=player['oderId'])
                        # Clean up session and requeue
                        if player['oderId'] in player_sessions:
                            del player_sessions[player['oderId']]
                        leave_room(room_id, sid=player['oderId'])
                        matchmaking_queue.append({
                            'sid': player['oderId'],
                            'name': player['name'],
                            'joinedAt': time.time()
                        })

                    # Delete the room
                    del rooms[room_id]
                    print(f'Match {room_id} cancelled due to timeout')

                    # Check if we can start a new match with requeued players
                    broadcast_queue_status()
                    check_and_start_match()

            # Clean up timeout reference
            if room_id in match_timeouts:
                del match_timeouts[room_id]

        # Start timeout timer
        timer = threading.Timer(30, handle_confirmation_timeout)
        timer.start()
        match_timeouts[room_id] = timer

        return True
    return False

@socketio.on('confirm_match')
def handle_confirm_match():
    """Handle player confirming their quickplay match"""
    sid = request.sid

    if sid not in player_sessions:
        emit('error', {'message': 'Not in a match'})
        return

    session = player_sessions[sid]
    room_id = session['roomId']
    position = session['position']

    if room_id not in rooms:
        emit('error', {'message': 'Match not found'})
        return

    room = rooms[room_id]

    # Only for quickmatch in confirming status
    if not room['metadata'].get('isQuickMatch') or room['metadata']['status'] != 'confirming':
        emit('error', {'message': 'Not in confirmation phase'})
        return

    # Mark player as confirmed
    if position in room['players']:
        room['players'][position]['confirmed'] = True
        room['players'][position]['ready'] = True

        print(f'Player {room["players"][position]["name"]} confirmed match {room_id}')

        # Notify all players of the confirmation
        socketio.emit('player_confirmed', {
            'position': position,
            'players': room['players']
        }, room=room_id)

        # Check if all players confirmed
        all_confirmed = all(p.get('confirmed', False) for p in room['players'].values())

        if all_confirmed:
            # Cancel the timeout timer
            if room_id in match_timeouts:
                match_timeouts[room_id].cancel()
                del match_timeouts[room_id]

            # Transition to waiting/ready to start
            room['metadata']['status'] = 'waiting'

            print(f'All players confirmed in match {room_id} - ready to start')

            # Notify all players that match is confirmed
            socketio.emit('all_confirmed', {
                'roomId': room_id,
                'players': room['players']
            }, room=room_id)

def broadcast_queue_status():
    """Broadcast current queue count to all waiting players"""
    count = len(matchmaking_queue)
    for player in matchmaking_queue:
        socketio.emit('queue_update', {
            'playersInQueue': count,
            'playersNeeded': 4 - count
        }, to=player['sid'])

@socketio.on('join_queue')
def handle_join_queue(data):
    sid = request.sid
    player_name = data.get('playerName', 'Player')

    # Remove if already in queue (rejoin)
    remove_from_queue(sid)

    # Check if already in a room
    if sid in player_sessions:
        emit('error', {'message': 'Already in a room. Leave first.'})
        return

    # Add to queue
    matchmaking_queue.append({
        'sid': sid,
        'name': player_name,
        'joinedAt': time.time()
    })

    print(f'{player_name} joined matchmaking queue. Queue size: {len(matchmaking_queue)}')

    emit('queue_joined', {
        'playersInQueue': len(matchmaking_queue),
        'playersNeeded': max(0, 4 - len(matchmaking_queue))
    })

    # Broadcast updated queue status to all waiting
    broadcast_queue_status()

    # Check if we can start a match
    check_and_start_match()

@socketio.on('leave_queue')
def handle_leave_queue():
    sid = request.sid

    was_in_queue = any(p['sid'] == sid for p in matchmaking_queue)
    remove_from_queue(sid)

    if was_in_queue:
        print(f'Player left matchmaking queue. Queue size: {len(matchmaking_queue)}')
        emit('queue_left', {})
        broadcast_queue_status()

# Need to import request for sid access
from flask import request

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    print(f'Starting Thaasbai server on port {port}...')
    socketio.run(app, host='0.0.0.0', port=port, debug=False, allow_unsafe_werkzeug=True)
