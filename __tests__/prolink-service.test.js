const { EventEmitter } = require('events')
const { ProLinkService } = require('../lib/prolink-service')
const { encodeCommand } = require('../lib/prolink-codec')

function network() {
	const sockets = []
	const servers = []
	const udpSockets = []
	const fake = {
		networkInterfaces: () => ({ Ethernet: [{ family: 'IPv6', address: 'fe80::123', scopeid: 7 }] }),
		createServer: () => {
			const server = new EventEmitter()
			server.listen = jest.fn(() => {
				server.listening = true
				queueMicrotask(() => server.emit('listening'))
			})
			server.address = () => ({ port: 54321 })
			server.close = jest.fn((cb) => {
				server.listening = false
				cb?.()
			})
			servers.push(server)
			return server
		},
		createSocket: () => {
			const udp = new EventEmitter()
			udp.bind = jest.fn(() => queueMicrotask(() => udp.emit('listening')))
			udp.addMembership = jest.fn()
			udp.dropMembership = jest.fn()
			udp.setMulticastTTL = jest.fn()
			udp.send = jest.fn((bytes, port, address, cb) => cb?.())
			udp.close = jest.fn((cb) => cb?.())
			udpSockets.push(udp)
			return udp
		},
	}
	function peer() {
		const socket = new EventEmitter()
		socket.writable = true
		socket.writableLength = 0
		socket.write = jest.fn(() => true)
		socket.destroy = jest.fn(() => {
			socket.destroyed = true
			socket.emit('close')
		})
		socket.setNoDelay = jest.fn()
		sockets.push(socket)
		servers.at(-1).emit('connection', socket)
		return socket
	}
	return { fake, servers, udpSockets, sockets, peer }
}

test('discovery advertises ephemeral port; one peer, hello timer, heartbeat and no replay', async () => {
	const n = network()
	const service = new ProLinkService(() => {}, n.fake)
	await service.start({ interfaceName: 'Ethernet', name: 'Mixing Station' })
	expect(service.state).toBe('waiting')
	expect(n.servers[0].listen).toHaveBeenCalledWith({ port: 0, host: '::', ipv6Only: true })
	expect(n.udpSockets[0].addMembership).toHaveBeenCalledWith('ff12::7776', '::%7')
	n.udpSockets[0].emit('message', Buffer.from('query'), { address: 'fe80::456%7', port: 12345 })
	const [reply, port, address] = n.udpSockets[0].send.mock.calls[0]
	expect(reply.readUInt16BE(38)).toBe(54321)
	expect([port, address]).toEqual([12345, 'fe80::456%7'])
	expect(() => service.send('RecallSnapshot', 9)).toThrow(/connected/i)
	jest.useFakeTimers()
	try {
		const peer = n.peer()
		expect(service.state).toBe('connected')
		expect(peer.write.mock.calls[0][0].readInt32BE(8)).toBe(1)
		jest.advanceTimersByTime(500)
		expect(peer.write).toHaveBeenCalledTimes(3)
		expect(n.peer().destroy).toHaveBeenCalledTimes(1)
		peer.emit('data', Buffer.from('00000001576176650000000200000000', 'hex'))
		expect(service.lastHeartbeat).toBeGreaterThan(0)
		expect(service.send('ShowRackByID', 7)).toBe(0)
		expect(peer.write.mock.calls.at(-1)[0].subarray(-8).toString('hex')).toBe('0000000000000007')
		peer.emit('data', encodeCommand('RecallSnapshot', 0, 1).subarray(0, 20))
		peer.destroy()
		expect(service.state).toBe('waiting')
		const replacement = n.peer()
		replacement.emit('data', Buffer.from('00000001576176650000000400000000', 'hex'))
		expect(service.state).toBe('connected')
		expect(replacement.write).toHaveBeenCalledTimes(1)
		expect(service.send('ShowRackByID', 63)).toBe(1)
		await service.stop()
		expect(service.state).toBe('stopped')
		expect(jest.getTimerCount()).toBe(0)
		expect(peer.listenerCount('data')).toBe(0)
		expect(replacement.listenerCount('data')).toBe(0)
		expect(n.servers[0].listenerCount('connection')).toBe(0)
		expect(n.udpSockets[0].listenerCount('message')).toBe(0)
	} finally {
		await service.stop()
		jest.useRealTimers()
	}
})

test('invalid frames disconnect only the peer; fresh peer has fresh parser', async () => {
	const n = network()
	const service = new ProLinkService(() => {}, n.fake)
	await service.start({ interfaceName: 'Ethernet' })
	const peer = n.peer()
	peer.emit('data', Buffer.from('000000015761766500000005ffffffff', 'hex'))
	expect(peer.destroyed).toBe(true)
	expect(service.state).toBe('waiting')
	n.peer()
	expect(service.state).toBe('connected')
	await service.stop()
})

test.each(
	[
		[],
		[{ family: 'IPv4', address: '127.0.0.1' }],
		[{ family: 'IPv6', address: '2001::1' }],
		[
			{ family: 'IPv6', address: 'fe80::1' },
			{ family: 'IPv6', address: 'fe80::2' },
		],
	].map((entries) => [entries]),
)('rejects incompatible interface %j before opening sockets', async (entries) => {
	const n = network()
	n.fake.networkInterfaces = () => ({ Ethernet: entries })
	const service = new ProLinkService(() => {}, n.fake)
	await expect(service.start({ interfaceName: 'Ethernet' })).rejects.toThrow(/IPv6/)
	expect(n.servers).toHaveLength(0)
	expect(service.state).toBe('fault')
	await service.stop()
})

test('membership failure cleans both sockets and later restart succeeds', async () => {
	const n = network()
	const create = n.fake.createSocket
	n.fake.createSocket = () => {
		const udp = create()
		udp.addMembership.mockImplementation(() => {
			throw new Error('membership failed')
		})
		return udp
	}
	const service = new ProLinkService(() => {}, n.fake)
	await expect(service.start({ interfaceName: 'Ethernet' })).rejects.toThrow('membership failed')
	expect(n.servers[0].close).toHaveBeenCalled()
	expect(n.udpSockets[0].close).toHaveBeenCalled()
	service.io.createSocket = create
	await service.start({ interfaceName: 'Ethernet' })
	expect(service.state).toBe('waiting')
	await service.stop()
})

test('serialized overlapping start/stop leaves no live listeners; slow peer cannot accumulate commands', async () => {
	const n = network()
	const service = new ProLinkService(() => {}, n.fake)
	await Promise.all([
		service.start({ interfaceName: 'Ethernet' }),
		service.stop(),
		service.start({ interfaceName: 'Ethernet' }),
	])
	expect(n.servers[0].listenerCount('connection')).toBe(0)
	const peer = n.peer()
	peer.writableLength = 65536
	expect(() => service.send('RecallSnapshot', 2)).toThrow(/backpressure/i)
	expect(peer.destroyed).toBe(true)
	await service.stop()
})

test('TCP peers arriving during UDP startup are rejected and cannot prevent cleanup', async () => {
	const n = network()
	let earlyPeer
	const create = n.fake.createSocket
	n.fake.createSocket = () => {
		earlyPeer = n.peer()
		return create()
	}
	const service = new ProLinkService(() => {}, n.fake)
	await service.start({ interfaceName: 'Ethernet' })
	expect(earlyPeer.destroyed).toBe(true)
	expect(service.state).toBe('waiting')
	await service.stop()
})

test('UDP bind errors release the TCP port; TCP runtime errors stop both listeners', async () => {
	const n = network()
	const create = n.fake.createSocket
	n.fake.createSocket = () => {
		const udp = create()
		udp.bind = () => queueMicrotask(() => udp.emit('error', new Error('EADDRINUSE')))
		return udp
	}
	const service = new ProLinkService(() => {}, n.fake)
	await expect(service.start({ interfaceName: 'Ethernet' })).rejects.toThrow('EADDRINUSE')
	expect(n.servers[0].close).toHaveBeenCalled()
	service.io.createSocket = create
	await service.start({ interfaceName: 'Ethernet' })
	const peer = n.peer()
	n.servers.at(-1).emit('error', new Error('interface lost'))
	await service.operations
	expect(service.state).toBe('fault')
	expect(peer.destroyed).toBe(true)
	expect(n.udpSockets.at(-1).close).toHaveBeenCalled()
	await service.stop()
})

test('real IPv6 loopback TCP exchanges Hello and commands and reconnects without replay', async () => {
	const net = require('net')
	const { once } = require('events')
	const n = network()
	const service = new ProLinkService(() => {}, { ...n.fake, createServer: net.createServer })
	const peers = []
	async function connect() {
		const socket = net.connect({ host: '::1', port: service.port })
		peers.push(socket)
		const received = once(socket, 'data')
		await once(socket, 'connect')
		const [hello] = await received
		expect(hello.readInt32BE(8)).toBe(1)
		return socket
	}
	try {
		await service.start({ interfaceName: 'Ethernet' })
		const first = await connect()
		const incoming = once(first, 'data')
		service.send('ShowRackByID', 7)
		const [command] = await incoming
		expect(command.subarray(-8).toString('hex')).toBe('0000000000000007')
		const disconnected = new Promise((resolve) => {
			service.onState = (state) => {
				if (state === 'waiting') resolve()
			}
		})
		first.destroy()
		await disconnected
		await connect()
		expect(service.state).toBe('connected')
	} finally {
		peers.forEach((socket) => socket.destroy())
		await service.stop()
	}
})
