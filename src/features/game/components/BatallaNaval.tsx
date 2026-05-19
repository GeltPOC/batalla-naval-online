'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { io, Socket } from 'socket.io-client'

const GRID = 10
const BASE = '/batalla-naval-online'

const SHIPS = [
  { name: 'Portaaviones', size: 5 },
  { name: 'Acorazado', size: 4 },
  { name: 'Crucero', size: 3 },
  { name: 'Submarino', size: 3 },
  { name: 'Destructor', size: 2 },
]

type Cell = null | 'S' | 'X' | 'W' | 'E'
type Board = Cell[][]
type Phase = 'lobby' | 'placement' | 'battle' | 'ended'

interface Notification {
  id: number
  text: string
  type: 'hit' | 'miss' | 'win' | 'lose' | 'info'
}

function emptyBoard(): Board {
  return Array.from({ length: GRID }, () => Array(GRID).fill(null))
}

function canPlace(board: Board, row: number, col: number, size: number, horiz: boolean): boolean {
  for (let i = 0; i < size; i++) {
    const r = horiz ? row : row + i
    const c = horiz ? col + i : col
    if (r < 0 || r >= GRID || c < 0 || c >= GRID) return false
    if (board[r][c] === 'S') return false
    // check adjacency
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nr = r + dr,
          nc = c + dc
        if (nr >= 0 && nr < GRID && nc >= 0 && nc < GRID && board[nr][nc] === 'S') return false
      }
    }
  }
  return true
}

function placeShip(board: Board, row: number, col: number, size: number, horiz: boolean): Board {
  const next = board.map((r) => [...r]) as Board
  for (let i = 0; i < size; i++) {
    const r = horiz ? row : row + i
    const c = horiz ? col + i : col
    next[r][c] = 'S'
  }
  return next
}

function cellColor(cell: Cell, isOwn: boolean): string {
  if (cell === 'X') return 'bg-red-500 border-red-400'
  if (cell === 'W') return 'bg-blue-400 border-blue-300'
  if (cell === 'S' && isOwn) return 'bg-green-600 border-green-500'
  return 'bg-slate-700 border-slate-600 hover:bg-slate-600'
}

export default function BatallaNaval() {
  const socketRef = useRef<Socket | null>(null)
  const [phase, setPhase] = useState<Phase>('lobby')
  const [playerName, setPlayerName] = useState('')
  const [roomCode, setRoomCode] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [playerIndex, setPlayerIndex] = useState<0 | 1>(0)
  const [myBoard, setMyBoard] = useState<Board>(emptyBoard())
  const [enemyBoard, setEnemyBoard] = useState<Board>(emptyBoard())
  const [shipIdx, setShipIdx] = useState(0)
  const [horiz, setHoriz] = useState(true)
  const [hoverCells, setHoverCells] = useState<Set<string>>(new Set())
  const [isMyTurn, setIsMyTurn] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [players, setPlayers] = useState<{ name: string; ready: boolean }[]>([])
  const [waitingMsg, setWaitingMsg] = useState('')
  const [gameOver, setGameOver] = useState<{ won: boolean; name: string } | null>(null)
  const [myId, setMyId] = useState('')
  const [enemyReady, setEnemyReady] = useState(false)
  const [myReady, setMyReady] = useState(false)
  const notifId = useRef(0)

  const addNotif = useCallback((text: string, type: Notification['type']) => {
    const id = ++notifId.current
    setNotifications((prev) => [...prev.slice(-4), { id, text, type }])
    setTimeout(() => setNotifications((prev) => prev.filter((n) => n.id !== id)), 3500)
  }, [])

  useEffect(() => {
    const socket = io({ path: `${BASE}/socket.io`, transports: ['websocket'] })
    socketRef.current = socket
    setMyId(socket.id || '')
    socket.on('connect', () => setMyId(socket.id || ''))

    socket.on(
      'room_created',
      ({ code, playerIndex: idx }: { code: string; playerIndex: 0 | 1 }) => {
        setRoomCode(code)
        setPlayerIndex(idx)
        setWaitingMsg('Sala creada. Esperando al segundo jugador...')
      },
    )

    socket.on('room_joined', ({ code, playerIndex: idx }: { code: string; playerIndex: 0 | 1 }) => {
      setRoomCode(code)
      setPlayerIndex(idx)
      setWaitingMsg('Te uniste a la sala. Esperando...')
    })

    socket.on(
      'player_joined',
      ({ players: ps }: { players: { name: string; ready: boolean }[] }) => {
        setPlayers(ps)
        setWaitingMsg('')
        setPhase('placement')
        addNotif('¡El rival se unió! Coloca tus barcos.', 'info')
      },
    )

    socket.on(
      'player_ready',
      ({ players: ps }: { players: { name: string; ready: boolean }[] }) => {
        setPlayers(ps)
        const me = ps[playerIndex]
        const enemy = ps[1 - playerIndex]
        if (me) setMyReady(me.ready)
        if (enemy) setEnemyReady(enemy.ready)
        if (enemy?.ready) addNotif('El rival está listo.', 'info')
      },
    )

    socket.on(
      'game_start',
      ({ turn, players: ps }: { turn: string; players: { id: string; name: string }[] }) => {
        setPhase('battle')
        setIsMyTurn(turn === socket.id)
        addNotif(
          turn === socket.id
            ? '¡Empieza la batalla! Es tu turno.'
            : '¡Empieza la batalla! Turno del rival.',
          'info',
        )
      },
    )

    socket.on(
      'fire_result',
      ({
        row,
        col,
        result,
        attackerId,
        nextTurn,
      }: {
        row: number
        col: number
        result: string
        attackerId: string
        nextTurn: string
      }) => {
        if (attackerId === socket.id) {
          setEnemyBoard((prev) => {
            const next = prev.map((r) => [...r]) as Board
            next[row][col] = result === 'hit' ? 'X' : 'W'
            return next
          })
          if (result === 'hit') addNotif('¡IMPACTO! Vuelves a disparar.', 'hit')
          else addNotif('Agua. Turno del rival.', 'miss')
        } else {
          setMyBoard((prev) => {
            const next = prev.map((r) => [...r]) as Board
            next[row][col] = result === 'hit' ? 'X' : 'W'
            return next
          })
          if (result === 'hit') addNotif('¡Te han dado! El rival vuelve a disparar.', 'miss')
          else addNotif('Fallaron. ¡Tu turno!', 'hit')
        }
        setIsMyTurn(nextTurn === socket.id)
      },
    )

    socket.on('game_over', ({ winnerId, winnerName }: { winnerId: string; winnerName: string }) => {
      setPhase('ended')
      const won = winnerId === socket.id
      setGameOver({ won, name: winnerName })
      addNotif(won ? '🏆 ¡GANASTE!' : `💀 ${winnerName} ganó.`, won ? 'win' : 'lose')
    })

    socket.on('player_disconnected', ({ name }: { name: string }) => {
      addNotif(`${name} se desconectó. La sala se cerró.`, 'info')
      setPhase('lobby')
      setGameOver(null)
      setMyBoard(emptyBoard())
      setEnemyBoard(emptyBoard())
      setShipIdx(0)
      setMyReady(false)
      setEnemyReady(false)
    })

    socket.on('error_msg', (msg: string) => addNotif(msg, 'info'))

    return () => {
      socket.disconnect()
    }
  }, [addNotif, playerIndex])

  const handleCreate = () => {
    if (!playerName.trim()) return
    socketRef.current?.emit('create_room', { playerName: playerName.trim() })
  }

  const handleJoin = () => {
    if (!playerName.trim() || !joinCode.trim()) return
    socketRef.current?.emit('join_room', {
      code: joinCode.trim().toUpperCase(),
      playerName: playerName.trim(),
    })
  }

  const handleHoverBoard = useCallback(
    (row: number, col: number) => {
      if (shipIdx >= SHIPS.length) return
      const size = SHIPS[shipIdx].size
      const cells = new Set<string>()
      let valid = true
      for (let i = 0; i < size; i++) {
        const r = horiz ? row : row + i
        const c = horiz ? col + i : col
        if (r < 0 || r >= GRID || c < 0 || c >= GRID) {
          valid = false
          break
        }
        cells.add(`${r}-${c}`)
      }
      if (!valid) {
        setHoverCells(new Set())
        return
      }
      setHoverCells(cells)
    },
    [shipIdx, horiz],
  )

  const handlePlaceShip = useCallback(
    (row: number, col: number) => {
      if (shipIdx >= SHIPS.length) return
      const size = SHIPS[shipIdx].size
      if (!canPlace(myBoard, row, col, size, horiz)) {
        addNotif('No puedes colocar ahí.', 'info')
        return
      }
      const next = placeShip(myBoard, row, col, size, horiz)
      setMyBoard(next)
      const nextIdx = shipIdx + 1
      setShipIdx(nextIdx)
      if (nextIdx >= SHIPS.length) {
        addNotif('¡Todos los barcos colocados! Pulsa Listo.', 'info')
      }
    },
    [shipIdx, horiz, myBoard, addNotif],
  )

  const handleReady = () => {
    socketRef.current?.emit('submit_board', { code: roomCode, board: myBoard })
    setMyReady(true)
  }

  const handleFire = useCallback(
    (row: number, col: number) => {
      if (!isMyTurn || phase !== 'battle') return
      const cell = enemyBoard[row][col]
      if (cell === 'X' || cell === 'W') return
      socketRef.current?.emit('fire', { code: roomCode, row, col })
    },
    [isMyTurn, phase, enemyBoard, roomCode],
  )

  const handleReset = () => {
    setPhase('lobby')
    setRoomCode('')
    setJoinCode('')
    setMyBoard(emptyBoard())
    setEnemyBoard(emptyBoard())
    setShipIdx(0)
    setHoriz(true)
    setGameOver(null)
    setMyReady(false)
    setEnemyReady(false)
    setPlayers([])
    setWaitingMsg('')
    socketRef.current?.disconnect()
    const socket = io({ path: `${BASE}/socket.io`, transports: ['websocket'] })
    socketRef.current = socket
    setMyId(socket.id || '')
    socket.on('connect', () => setMyId(socket.id || ''))
    // re-attach all listeners by forcing re-mount would be cleaner; for now reload
    window.location.reload()
  }

  // ── RENDER ──
  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-6">
      <h1 className="text-4xl font-bold text-cyan-400 mb-2 tracking-wide">⚓ Batalla Naval</h1>
      <p className="text-slate-400 mb-6 text-sm">Multijugador en tiempo real</p>

      {/* Notifications */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-72">
        {notifications.map((n) => (
          <div
            key={n.id}
            className={`px-4 py-2 rounded-lg text-sm font-semibold shadow-lg transition-all ${
              n.type === 'hit'
                ? 'bg-red-600 text-white'
                : n.type === 'miss'
                  ? 'bg-blue-600 text-white'
                  : n.type === 'win'
                    ? 'bg-yellow-500 text-black'
                    : n.type === 'lose'
                      ? 'bg-gray-700 text-white'
                      : 'bg-slate-600 text-white'
            }`}
          >
            {n.text}
          </div>
        ))}
      </div>

      {/* LOBBY */}
      {phase === 'lobby' && (
        <div className="bg-slate-800 rounded-2xl p-8 w-full max-w-md shadow-2xl">
          <div className="mb-6">
            <label className="block text-slate-300 text-sm mb-1">Tu nombre</label>
            <input
              className="w-full bg-slate-700 rounded-lg px-4 py-2 text-white outline-none focus:ring-2 focus:ring-cyan-500"
              placeholder="Capitán..."
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              maxLength={20}
            />
          </div>
          <button
            onClick={handleCreate}
            disabled={!playerName.trim()}
            className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white font-bold py-3 rounded-xl mb-4 transition"
          >
            Crear sala
          </button>
          <div className="flex gap-2">
            <input
              className="flex-1 bg-slate-700 rounded-lg px-4 py-2 text-white outline-none focus:ring-2 focus:ring-emerald-500 uppercase tracking-widest"
              placeholder="Código de sala"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              maxLength={6}
            />
            <button
              onClick={handleJoin}
              disabled={!playerName.trim() || joinCode.length < 6}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold px-5 rounded-xl transition"
            >
              Unirse
            </button>
          </div>
          {roomCode && (
            <div className="mt-6 text-center">
              <p className="text-slate-400 text-sm mb-1">Código de tu sala:</p>
              <p className="text-3xl font-mono font-bold text-cyan-300 tracking-widest">
                {roomCode}
              </p>
              <p className="text-slate-500 text-xs mt-1">{waitingMsg}</p>
            </div>
          )}
        </div>
      )}

      {/* PLACEMENT */}
      {phase === 'placement' && (
        <div className="flex flex-col items-center gap-4 w-full max-w-2xl">
          <div className="bg-slate-800 rounded-xl px-6 py-3 text-center">
            <p className="text-slate-300 text-sm">
              Sala: <span className="font-mono text-cyan-400 font-bold">{roomCode}</span>
            </p>
            <p className="text-slate-300 text-sm mt-1">
              {shipIdx < SHIPS.length ? (
                <>
                  Coloca: <span className="text-yellow-400 font-bold">{SHIPS[shipIdx].name}</span> (
                  {SHIPS[shipIdx].size} casillas)
                </>
              ) : (
                <span className="text-green-400 font-bold">¡Todos los barcos colocados!</span>
              )}
            </p>
            <div className="flex gap-3 mt-3 justify-center">
              <button
                onClick={() => setHoriz((h) => !h)}
                className="bg-slate-600 hover:bg-slate-500 px-4 py-1 rounded-lg text-sm transition"
              >
                Rotar: {horiz ? '→ Horizontal' : '↓ Vertical'}
              </button>
              {shipIdx >= SHIPS.length && !myReady && (
                <button
                  onClick={handleReady}
                  className="bg-green-600 hover:bg-green-500 px-4 py-1 rounded-lg text-sm font-bold transition"
                >
                  ✓ Listo
                </button>
              )}
            </div>
            {myReady && (
              <p className="text-green-400 text-xs mt-2">
                Esperando al rival... {enemyReady ? '(Listo ✓)' : '(No listo)'}
              </p>
            )}
          </div>
          <div>
            <p className="text-center text-slate-400 text-xs mb-2">Tu tablero</p>
            <Grid
              board={myBoard}
              isOwn={true}
              interactive={shipIdx < SHIPS.length}
              hoverCells={hoverCells}
              onHover={handleHoverBoard}
              onLeave={() => setHoverCells(new Set())}
              onClick={handlePlaceShip}
            />
          </div>
        </div>
      )}

      {/* BATTLE */}
      {phase === 'battle' && (
        <div className="flex flex-col items-center gap-6 w-full">
          <div
            className={`px-6 py-2 rounded-full text-sm font-bold ${
              isMyTurn ? 'bg-yellow-500 text-black' : 'bg-slate-700 text-slate-300'
            }`}
          >
            {isMyTurn ? '🎯 Tu turno — Dispara al tablero enemigo' : '⏳ Turno del rival...'}
          </div>
          <div className="flex flex-col md:flex-row gap-8 justify-center w-full">
            <div className="flex flex-col items-center gap-2">
              <p className="text-slate-400 text-sm font-semibold">👤 Tu tablero</p>
              <Grid
                board={myBoard}
                isOwn={true}
                interactive={false}
                hoverCells={new Set()}
                onHover={() => {}}
                onLeave={() => {}}
                onClick={() => {}}
              />
            </div>
            <div className="flex flex-col items-center gap-2">
              <p
                className={`text-sm font-semibold ${isMyTurn ? 'text-yellow-400' : 'text-slate-400'}`}
              >
                🎯 Tablero enemigo {isMyTurn ? '← Dispara aquí' : ''}
              </p>
              <Grid
                board={enemyBoard}
                isOwn={false}
                interactive={isMyTurn}
                hoverCells={new Set()}
                onHover={() => {}}
                onLeave={() => {}}
                onClick={handleFire}
              />
            </div>
          </div>
          <Legend />
        </div>
      )}

      {/* ENDED */}
      {phase === 'ended' && gameOver && (
        <div className="flex flex-col items-center gap-4 mt-8">
          <div className={`text-6xl mb-2`}>{gameOver.won ? '🏆' : '💀'}</div>
          <h2 className={`text-3xl font-bold ${gameOver.won ? 'text-yellow-400' : 'text-red-400'}`}>
            {gameOver.won ? '¡VICTORIA!' : 'DERROTA'}
          </h2>
          <p className="text-slate-300">
            {gameOver.won
              ? '¡Hundiste toda la flota enemiga!'
              : `${gameOver.name} hundió tu flota.`}
          </p>
          <div className="flex flex-col md:flex-row gap-6 mt-4">
            <div className="flex flex-col items-center gap-2">
              <p className="text-slate-400 text-sm">Tu tablero</p>
              <Grid
                board={myBoard}
                isOwn={true}
                interactive={false}
                hoverCells={new Set()}
                onHover={() => {}}
                onLeave={() => {}}
                onClick={() => {}}
              />
            </div>
            <div className="flex flex-col items-center gap-2">
              <p className="text-slate-400 text-sm">Tablero enemigo</p>
              <Grid
                board={enemyBoard}
                isOwn={false}
                interactive={false}
                hoverCells={new Set()}
                onHover={() => {}}
                onLeave={() => {}}
                onClick={() => {}}
              />
            </div>
          </div>
          <button
            onClick={handleReset}
            className="mt-4 bg-cyan-600 hover:bg-cyan-500 text-white font-bold px-8 py-3 rounded-xl transition"
          >
            Jugar de nuevo
          </button>
        </div>
      )}
    </div>
  )
}

function Grid({
  board,
  isOwn,
  interactive,
  hoverCells,
  onHover,
  onLeave,
  onClick,
}: {
  board: Board
  isOwn: boolean
  interactive: boolean
  hoverCells: Set<string>
  onHover: (r: number, c: number) => void
  onLeave: () => void
  onClick: (r: number, c: number) => void
}) {
  const cols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']
  return (
    <div className="select-none">
      <div className="flex">
        <div className="w-5 h-5" />
        {cols.map((c) => (
          <div key={c} className="w-7 h-5 text-center text-xs text-slate-500 font-mono">
            {c}
          </div>
        ))}
      </div>
      {board.map((row, r) => (
        <div key={r} className="flex">
          <div className="w-5 h-7 flex items-center justify-end pr-1 text-xs text-slate-500 font-mono">
            {r + 1}
          </div>
          {row.map((cell, c) => {
            const isHover = hoverCells.has(`${r}-${c}`)
            const base = cellColor(cell, isOwn)
            const hoverClass = isHover ? 'bg-yellow-400 border-yellow-300' : ''
            const fired = cell === 'X' || cell === 'W'
            const cursor = interactive && !fired ? 'cursor-pointer' : 'cursor-default'
            return (
              <div
                key={c}
                className={`w-7 h-7 border text-center flex items-center justify-center text-xs font-bold transition-colors ${
                  isHover ? hoverClass : base
                } ${cursor}`}
                onMouseEnter={() => interactive && onHover(r, c)}
                onMouseLeave={() => interactive && onLeave()}
                onClick={() => interactive && onClick(r, c)}
              >
                {cell === 'X' && <span>💥</span>}
                {cell === 'W' && <span className="text-blue-200">○</span>}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function Legend() {
  return (
    <div className="flex gap-4 text-xs text-slate-400 mt-2">
      <span className="flex items-center gap-1">
        <span className="inline-block w-4 h-4 bg-green-600 rounded"></span> Tu barco
      </span>
      <span className="flex items-center gap-1">💥 Impacto</span>
      <span className="flex items-center gap-1">
        <span className="text-blue-200 text-base">○</span> Agua
      </span>
    </div>
  )
}
