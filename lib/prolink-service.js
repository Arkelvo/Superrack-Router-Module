const net = require('net')
const dgram = require('dgram')
const os = require('os')
const { performance } = require('perf_hooks')
const { encodeHello, encodeDiscovery, encodeCommand, WaveParser } = require('./prolink-codec')

const GROUP = 'ff12::7776'
const PORT = 40123

function selectedInterface(name, interfaces) {
	const addresses = (interfaces[name] || []).filter((a) => a.family === 'IPv6' || a.family === 6)
	if (addresses.length !== 1 || !/^fe[89ab][0-9a-f]:/i.test(addresses[0].address)) {
		throw new Error(
			`ProLink interface "${name || '(not selected)'}" requires exactly one IPv6 address, which must be link-local (fe80::/10)`,
		)
	}
	const address = addresses[0]
	// Node/libuv IPv6 multicast membership takes an interface zone, not an IPv4 address.
	return `::%${name}`
}

function waitListening(resource, bind) {
	return new Promise((resolve, reject) => {
		const finish = (error) => {
			clearTimeout(timer)
			resource.removeListener('error', failed)
			resource.removeListener('listening', ready)
			error ? reject(error) : resolve()
		}
		const failed = (error) => finish(error)
		const ready = () => finish()
		const timer = setTimeout(() => finish(new Error('ProLink listener startup timed out')), 5000)
		resource.once('error', failed)
		resource.once('listening', ready)
		try {
			bind()
		} catch (error) {
			finish(error)
		}
	})
}

class ProLinkService {
	constructor(onState = () => {}, dependencies = {}) {
		this.io = {
			createServer: net.createServer,
			createSocket: dgram.createSocket,
			networkInterfaces: os.networkInterfaces,
			...dependencies,
		}
		this.onState = onState
		this.state = 'stopped'
		this.sequence = 0
		this.generation = 0
		this.operations = Promise.resolve()
	}
	_setState(state, error = '') {
		this.state = state
		this.error = error
		this.onState(state, error)
	}
	_enqueue(operation) {
		const next = this.operations.then(operation)
		this.operations = next.catch(() => {})
		return next
	}
	start(options) {
		return this._enqueue(() => this._start(options))
	}
	stop() {
		return this._enqueue(async () => {
			await this._cleanup()
			this._setState('stopped')
		})
	}
	async _start(options) {
		await this._cleanup()
		this._setState('starting')
		const generation = this.generation
		let startupError
		const fatal = (error) => {
			if (generation !== this.generation || this.state === 'fault') return
			if (this.state === 'starting') {
				startupError = error
				return
			}
			this._setState('fault', `ProLink network error: ${error.message}`)
			void this._enqueue(async () => {
				if (generation === this.generation) await this._cleanup()
			})
		}
		try {
			this.zone = selectedInterface(options.interfaceName, this.io.networkInterfaces())
			this.name = options.name ?? 'Mixing Station'
			this.hello = encodeHello(this.name)
			const server = (this.server = this.io.createServer())
			server.on('error', fatal)
			server.on('connection', (socket) => {
				if (generation !== this.generation || !['waiting', 'connected'].includes(this.state) || this.peer) {
					socket.destroy()
					return
				}
				this._accept(socket)
			})
			await waitListening(server, () => server.listen({ port: 0, host: '::', ipv6Only: true }))
			this.port = server.address().port
			const reply = encodeDiscovery(this.port, this.name)
			const udp = (this.udp = this.io.createSocket({ type: 'udp6', reuseAddr: true }))
			udp.on('error', fatal)
			await waitListening(udp, () => udp.bind({ port: PORT, address: '::' }))
			if (startupError) throw startupError
			udp.setMulticastTTL(255)
			udp.addMembership(GROUP, this.zone)
			this.joined = true
			udp.on('message', (_message, source) => {
				if (generation !== this.generation || this.state === 'fault') return
				const address = source.address.includes('%')
					? source.address
					: /^fe[89ab][0-9a-f]:/i.test(source.address)
						? `${source.address}%${this.zone.split('%')[1]}`
						: source.address
				try {
					udp.send(reply, source.port, address, (error) => {
						if (error) fatal(error)
					})
				} catch (error) {
					fatal(error)
				}
			})
			this._setState('waiting')
		} catch (error) {
			await this._cleanup()
			this._setState('fault', `ProLink start failed: ${error.message}`)
			throw error
		}
	}
	_accept(socket) {
		const parser = new WaveParser()
		this.peer = socket
		this.lastHeartbeat = null
		const disconnect = (error) => {
			if (this.peer !== socket) return
			this._dropPeer()
			this._setState('waiting', error ? `ProLink peer disconnected: ${error.message}` : '')
		}
		const data = (bytes) => {
			if (this.peer !== socket) return
			try {
				for (const frame of parser.push(bytes)) {
					if (frame.type === 2 || frame.type === 4) this.lastHeartbeat = performance.now()
					// OSC metadata has no verified acknowledgement semantics; consume without dispatching actions.
				}
			} catch (error) {
				disconnect(error)
			}
		}
		const closed = () => disconnect()
		socket.on('data', data)
		socket.on('error', disconnect)
		socket.on('close', closed)
		socket.on('end', closed)
		this.peerCleanup = () => {
			clearInterval(this.heartbeatTimer)
			this.heartbeatTimer = null
			parser.reset()
			socket.removeListener('data', data)
			socket.removeListener('error', disconnect)
			socket.removeListener('close', closed)
			socket.removeListener('end', closed)
			// Absorb an already scheduled I/O error after destroy without retaining the service.
			socket.on('error', () => {})
			socket.destroy()
		}
		try {
			socket.setNoDelay(true)
			this._write(this.hello)
			this.heartbeatTimer = setInterval(() => {
				try {
					this._write(this.hello)
				} catch (error) {
					disconnect(error)
				}
			}, 250)
			this._setState('connected')
		} catch (error) {
			disconnect(error)
		}
	}
	_write(bytes) {
		const socket = this.peer
		if (!socket || socket.destroyed || !socket.writable) throw new Error('ProLink is not connected')
		if (socket.writableLength >= 65536) throw new Error('ProLink backpressure limit exceeded')
		socket.write(bytes)
	}
	send(command, id) {
		if (this.state !== 'connected') throw new Error('ProLink is not connected; command was not queued')
		const sequence = this.sequence
		const frame = encodeCommand(command, sequence, id)
		try {
			this._write(frame)
		} catch (error) {
			this._dropPeer()
			this._setState('waiting', error.message)
			throw error
		}
		this.sequence = (sequence + 1) | 0
		return sequence // Local write attempt only, never a remote acknowledgement.
	}
	_dropPeer() {
		this.peer = null
		this.lastHeartbeat = null
		this.peerCleanup?.()
		this.peerCleanup = null
	}
	async _cleanup() {
		this.generation++
		this._dropPeer()
		const udp = this.udp
		const server = this.server
		this.udp = this.server = null
		this.port = null
		if (udp && this.joined) {
			try {
				udp.dropMembership(GROUP, this.zone)
			} catch {}
		}
		this.joined = false
		await Promise.all(
			[udp, server].filter(Boolean).map(
				(resource) =>
					new Promise((resolve) => {
						resource.removeAllListeners()
						resource.on('error', () => {})
						try {
							resource.close(resolve)
						} catch {
							resolve()
						}
					}),
			),
		)
	}
}

module.exports = { ProLinkService, selectedInterface }
