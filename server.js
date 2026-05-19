const { createServer } = require('http')
const { parse } = require('url')
const next = require('next')
const { Server } = require('socket.io')

const dev = process.env.NODE_ENV !== 'production'
const port = parseInt(process.env.PORT || '3000', 10)
const app = next({ dev })
const handle = app.getRequestHandler()

// Estado en memoria
const rooms = {}

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let code = ''
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

function checkWin(board) {
  for (const row of board) {
    for (const cell of row) {
      if (cell === 'S') return false
    }
  }
  return true
}

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url, true)
    handle(req, res, parsedUrl)
  })

  const io = new Server(httpServer, {
    path: '/batalla-naval-online/socket.io',
    cors: { origin: '*' },
  })

  io.on('connection', (socket) => {
    console.log('connected:', socket.id)

    socket.on('create_room', ({ playerName }) => {
      let code
      do {
        code = generateRoomCode()
      } while (rooms[code])
      rooms[code] = {
        code,
        players: [{ id: socket.id, name: playerName, board: null, ready: false }],
        turn: null,
        phase: 'waiting',
      }
      socket.join(code)
      socket.emit('room_created', { code, playerIndex: 0 })
      console.log('room created:', code)
    })

    socket.on('join_room', ({ code, playerName }) => {
      const room = rooms[code]
      if (!room) {
        socket.emit('error_msg', 'Sala no encontrada')
        return
      }
      if (room.players.length >= 2) {
        socket.emit('error_msg', 'Sala llena')
        return
      }
      if (room.phase !== 'waiting') {
        socket.emit('error_msg', 'Partida en curso')
        return
      }
      room.players.push({ id: socket.id, name: playerName, board: null, ready: false })
      socket.join(code)
      socket.emit('room_joined', { code, playerIndex: 1 })
      io.to(code).emit('player_joined', {
        players: room.players.map((p) => ({ name: p.name, ready: p.ready })),
      })
      console.log('room joined:', code)
    })

    socket.on('submit_board', ({ code, board }) => {
      const room = rooms[code]
      if (!room) return
      const player = room.players.find((p) => p.id === socket.id)
      if (!player) return
      player.board = board
      player.ready = true
      io.to(code).emit('player_ready', {
        players: room.players.map((p) => ({ name: p.name, ready: p.ready })),
      })
      if (room.players.length === 2 && room.players.every((p) => p.ready)) {
        room.phase = 'battle'
        room.turn = room.players[0].id
        io.to(code).emit('game_start', {
          turn: room.turn,
          players: room.players.map((p) => ({ id: p.id, name: p.name })),
        })
      }
    })

    socket.on('fire', ({ code, row, col }) => {
      const room = rooms[code]
      if (!room || room.phase !== 'battle') return
      if (room.turn !== socket.id) return
      const attackerIdx = room.players.findIndex((p) => p.id === socket.id)
      const defenderIdx = 1 - attackerIdx
      const defender = room.players[defenderIdx]
      const cell = defender.board[row][col]
      let result
      if (cell === 'S') {
        defender.board[row][col] = 'X'
        result = checkWin(defender.board) ? 'sunk_win' : 'hit'
      } else if (cell === 'E' || cell === null || cell === 'W') {
        defender.board[row][col] = 'W'
        result = 'miss'
      } else {
        // already fired
        return
      }

      if (result === 'sunk_win') {
        room.phase = 'ended'
        io.to(code).emit('fire_result', { row, col, result: 'hit', attackerId: socket.id })
        io.to(code).emit('game_over', {
          winnerId: socket.id,
          winnerName: room.players[attackerIdx].name,
        })
      } else {
        if (result === 'miss') {
          room.turn = defender.id
        }
        // on hit, same player continues
        io.to(code).emit('fire_result', {
          row,
          col,
          result,
          attackerId: socket.id,
          nextTurn: room.turn,
        })
      }
    })

    socket.on('disconnect', () => {
      for (const code of Object.keys(rooms)) {
        const room = rooms[code]
        const idx = room.players.findIndex((p) => p.id === socket.id)
        if (idx !== -1) {
          io.to(code).emit('player_disconnected', { name: room.players[idx].name })
          delete rooms[code]
          break
        }
      }
    })
  })

  httpServer.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`)
  })
})
