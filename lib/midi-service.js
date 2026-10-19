const path = require('path')
const fs = require('fs')

const DEFAULT_PORT_BASENAME = 'SuperRack Router'
const ECHO_SUPPRESS_MS = 250
const SENT_HISTORY_LIMIT = 32
const HELPER_READY_TIMEOUT_MS = 10000
const HELPER_DEFAULT_RELATIVE = ['helper', 'dist', 'win-x64', 'SuperRackMidiHelper.exe']

// Converts a validated midi-map step ({type, channel, controller/note/program, value})
// into raw MIDI bytes. Returns null for unknown types.
function midiStepToBytes(step) {
	if (!step || typeof step !== 'object') return null
	const ch = Number(step.channel)
	if (!Number.isInteger(ch) || ch < 1 || ch > 16) return null
	const status = ch - 1
	if (step.type === 'cc') {
		return [0xb0 | status, Number(step.controller) & 0x7f, Number(step.value) & 0x7f]
	}
	if (step.type === 'noteon') {
		return [0x90 | status, Number(step.note ?? step.controller) & 0x7f, Number(step.value) & 0x7f]
	}
	if (step.type === 'program') {
		return [0xc0 | status, Number(step.program ?? step.controller) & 0x7f]
	}
	return null
}

// Backend selection: virtual ports are only possible on macOS (CoreMIDI) and
// Linux (ALSA) via RtMidi. On Windows the preferred backend is a helper
// process that registers a virtual device via Windows MIDI Services
// (Win11 24H2+); the loopMIDI-based rtmidi-open backend is the fallback.
function resolveBackend(config, platform) {
	if ((config?.controlTransport ?? 'midi') !== 'midi') return 'none'
	if (!config?.midiEnabled) return 'none'
	if (platform !== 'win32') return 'rtmidi-virtual'
	return config?.midiWinBackend === 'loopmidi' ? 'rtmidi-open' : 'winmidisvc'
}

// fs.existsSync THROWS under Node's permission model (Companion sandboxes
// modules with --permission) when the path is outside the allowed scope -
// treat that as "not accessible" instead of crashing init.
function _safeExists(p) {
	try {
		return fs.existsSync(p)
	} catch {
		return false
	}
}

function helperExePath(instance) {
	const configured = instance.config?.midiHelperPath
	if (typeof configured === 'string' && configured.trim()) return configured.trim()
	// Unbundled layout: this file lives in lib/, helper/ is one level up.
	// Webpacked module package: everything is bundled into pkg/main.js, so
	// __dirname IS the module root and helper/ sits next to it.
	const candidates = [
		path.join(__dirname, '..', ...HELPER_DEFAULT_RELATIVE),
		path.join(__dirname, ...HELPER_DEFAULT_RELATIVE),
	]
	return candidates.find((p) => _safeExists(p)) ?? candidates[0]
}

function portBaseName(instance) {
	const raw = instance.config?.midiPortName
	const name = typeof raw === 'string' && raw.trim() ? raw.trim() : DEFAULT_PORT_BASENAME
	return name
}

function midiConfigSnapshot(config) {
	return JSON.stringify({
		enabled: !!config?.midiEnabled,
		portName: config?.midiPortName || '',
		inChannel: config?.midiInChannel ?? null,
		inController: config?.midiInController ?? null,
		winBackend: config?.midiWinBackend || 'auto',
		helperPath: config?.midiHelperPath || '',
	})
}

function _findPortIndexByName(port, name) {
	const needle = name.toLowerCase()
	const count = port.getPortCount()
	for (let i = 0; i < count; i++) {
		if (String(port.getPortName(i)).toLowerCase().includes(needle)) return i
	}
	return -1
}

function _recordSent(midiState, bytes) {
	midiState.lastSent.push({ bytes: bytes.join(','), ts: Date.now() })
	if (midiState.lastSent.length > SENT_HISTORY_LIMIT) midiState.lastSent.shift()
}

function _isEcho(midiState, bytes) {
	const key = bytes.join(',')
	const now = Date.now()
	return midiState.lastSent.some((e) => e.bytes === key && now - e.ts <= ECHO_SUPPRESS_MS)
}

// Handles a raw incoming MIDI message. Default trigger mapping: a CC on the
// configured channel/controller carries the mixer channel number as value and
// routes the rack mapped to that channel (same semantics as trigger_channel).
function handleIncomingMidi(instance, message) {
	if (instance._destroyed || instance._transportSwitching || (instance.config?.controlTransport ?? 'midi') !== 'midi')
		return
	const midiState = instance._midi
	if (!midiState || !Array.isArray(message) || message.length < 2) return
	if (_isEcho(midiState, message)) {
		instance._log('debug', 'MIDI in: suppressed echo of own message', { message })
		return
	}
	const status = message[0] & 0xf0
	const channel = (message[0] & 0x0f) + 1
	if (status !== 0xb0) return // only CC is mapped for now
	const controller = message[1]
	const value = message[2] ?? 0

	const wantChannel = parseInt(instance.config?.midiInChannel, 10) || 1
	const wantController = parseInt(instance.config?.midiInController, 10)
	const controllerMatch = Number.isInteger(wantController) ? controller === wantController : controller === 1
	if (channel !== wantChannel || !controllerMatch) return

	const { resolveRackForChannel } = require('./midi-map')
	const rackId = resolveRackForChannel(instance.rackMap, value)
	instance._log('info', 'MIDI in: trigger channel received', { channel, controller, value, rackId })
	if (rackId) {
		Promise.resolve(instance.routeRack(rackId)).catch((e) => {
			instance._log('error', 'MIDI in: routeRack failed', { rackId, error: e?.message })
		})
	} else {
		instance._log('warn', 'MIDI in: no rack mapped to channel', { value })
	}
}

// Starts the Windows MIDI Services helper process (virtual device backend).
// Resolves true when the helper reported ready, false on any failure.
function _startHelperBackend(instance) {
	const midiState = instance._midi
	const exePath = helperExePath(instance)
	if (!_safeExists(exePath)) {
		instance._log(
			'warn',
			'MIDI service: Windows MIDI Services helper not found or not readable, falling back to loopMIDI backend',
			{
				exePath,
			},
		)
		return Promise.resolve(false)
	}
	const { spawn } = require('child_process')
	const baseName = portBaseName(instance)

	return new Promise((resolve) => {
		let settled = false
		const settle = (ok) => {
			if (!settled) {
				settled = true
				resolve(ok)
			}
		}
		let child
		try {
			child = spawn(exePath, ['--name', baseName], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
		} catch (e) {
			instance._log('error', 'MIDI service: failed to spawn helper', { error: e?.message })
			return settle(false)
		}
		// Retain even a not-yet-ready process so a failed start cannot leave an orphan helper.
		midiState.helper = child

		const readyTimer = setTimeout(() => {
			instance._log('error', 'MIDI service: helper did not report ready in time', {
				timeoutMs: HELPER_READY_TIMEOUT_MS,
			})
			try {
				child.kill()
			} catch {}
			settle(false)
		}, HELPER_READY_TIMEOUT_MS)

		let buffer = ''
		child.stdout.on('data', (chunk) => {
			buffer += chunk.toString()
			let nl
			while ((nl = buffer.indexOf('\n')) >= 0) {
				const line = buffer.slice(0, nl).trim()
				buffer = buffer.slice(nl + 1)
				if (!line) continue
				let msg
				try {
					msg = JSON.parse(line)
				} catch {
					instance._log('debug', 'MIDI helper: non-JSON output', { line })
					continue
				}
				if (msg.type === 'ready') {
					if (settled) continue
					clearTimeout(readyTimer)
					midiState.helper = child
					midiState.started = true
					instance._log('info', 'MIDI service: virtual device online via Windows MIDI Services', {
						endpointId: msg.endpointId,
						name: baseName,
					})
					settle(true)
				} else if (msg.type === 'midi' && Array.isArray(msg.bytes)) {
					try {
						handleIncomingMidi(instance, msg.bytes)
					} catch (e) {
						instance._log('error', 'MIDI in: handler error', { error: e?.message })
					}
				} else if (msg.type === 'log') {
					instance._log(
						msg.level === 'warn' || msg.level === 'error' ? msg.level : 'debug',
						`MIDI helper: ${msg.message}`,
					)
				} else if (msg.type === 'error') {
					instance._log('error', `MIDI helper: ${msg.message}`)
				}
			}
		})
		child.stderr.on('data', (chunk) =>
			instance._log('debug', 'MIDI helper stderr', { output: chunk.toString().slice(0, 500) }),
		)
		child.on('error', (e) => {
			instance._log('error', 'MIDI service: helper process error', { error: e?.message })
			clearTimeout(readyTimer)
			if (!child.pid && midiState.helper === child) midiState.helper = null
			settle(false)
		})
		child.on('exit', (code) => {
			clearTimeout(readyTimer)
			if (midiState.helper === child) {
				midiState.helper = null
				midiState.started = false
				if (code !== 0) instance._log('error', 'MIDI service: helper exited unexpectedly', { code })
			}
			settle(false)
		})
	})
}

async function startMidiService(instance) {
	instance._midi = instance._midi || {
		started: false,
		restarting: false,
		backend: 'none',
		input: null,
		output: null,
		helper: null,
		lastSent: [],
	}
	const midiState = instance._midi
	if (midiState.started) {
		instance._log('debug', 'MIDI service already running')
		return
	}
	midiState.configSnapshot = midiConfigSnapshot(instance.config)
	let backend = resolveBackend(instance.config, process.platform)
	midiState.backend = backend
	if (backend === 'none') {
		instance._log('debug', 'MIDI service disabled (variables-only mode)')
		return
	}

	if (backend === 'winmidisvc') {
		midiState.lastSent = []
		const ok = await _startHelperBackend(instance)
		if (ok) return
		await stopMidiService(instance)
		// Fallback: loopMIDI-based rtmidi backend
		backend = 'rtmidi-open'
		midiState.backend = backend
	}

	let midi
	try {
		midi = require('@julusian/midi')
	} catch (e) {
		instance._log('error', 'MIDI service: native module @julusian/midi could not be loaded', { error: e?.message })
		midiState.backend = 'none'
		return
	}

	const baseName = portBaseName(instance)
	const inName = `${baseName} In`
	const outName = `${baseName} Out`

	let input = null
	let output = null
	try {
		output = midiState.output = new midi.Output()
		input = midiState.input = new midi.Input()

		if (backend === 'rtmidi-virtual') {
			output.openVirtualPort(outName)
			input.openVirtualPort(inName)
			instance._log('info', 'MIDI service: virtual ports created', { in: inName, out: outName })
		} else {
			// Windows: open existing (loopMIDI) ports matching the configured name
			const outIdx = _findPortIndexByName(output, baseName)
			const inIdx = _findPortIndexByName(input, baseName)
			if (outIdx < 0 || inIdx < 0) {
				instance._log(
					'error',
					`MIDI service: no MIDI port matching "${baseName}" found. Create a loopMIDI port with this name (see HELP).`,
					{
						outFound: outIdx >= 0,
						inFound: inIdx >= 0,
					},
				)
				await stopMidiService(instance)
				return
			}
			output.openPort(outIdx)
			input.openPort(inIdx)
			instance._log('info', 'MIDI service: opened existing ports', {
				in: input.getPortName(inIdx),
				out: output.getPortName(outIdx),
			})
		}

		input.on('message', (_deltaTime, message) => {
			try {
				handleIncomingMidi(instance, message)
			} catch (e) {
				instance._log('error', 'MIDI in: handler error', { error: e?.message })
			}
		})

		midiState.input = input
		midiState.output = output
		midiState.lastSent = []
		midiState.started = true
	} catch (e) {
		// RtMidi init can fail on systems without a MIDI subsystem (e.g. headless Linux without ALSA seq)
		instance._log('error', 'MIDI service: failed to start, falling back to variables-only mode', { error: e?.message })
		// Preserve handles until confirmed closed, including partially opened backends.
		await stopMidiService(instance)
	}
}

async function stopMidiService(instance) {
	const midiState = instance._midi
	if (!midiState) return
	const helper = midiState.helper
	midiState.started = false
	if (helper) {
		await new Promise((resolve, reject) => {
			const exited = () => {
				clearTimeout(killTimer)
				clearTimeout(timeout)
				helper.removeListener('exit', exited)
				if (midiState.helper === helper) midiState.helper = null
				resolve()
			}
			const killTimer = setTimeout(() => {
				try {
					helper.kill()
				} catch {}
			}, 1000)
			const timeout = setTimeout(() => {
				helper.removeListener('exit', exited)
				reject(new Error('MIDI helper did not exit; other control transport remains disabled'))
			}, 3000)
			helper.once('exit', exited)
			if (helper.exitCode != null || helper.signalCode != null) {
				exited()
				return
			}
			try {
				helper.stdin.write(JSON.stringify({ type: 'quit' }) + '\n')
			} catch {}
		})
	}
	for (const key of ['input', 'output']) {
		const port = midiState[key]
		if (!port) continue
		let closed = false
		try {
			port.closePort()
			closed = true
		} catch {}
		try {
			port.destroy()
			closed = true
		} catch {}
		if (!closed) throw new Error(`MIDI port ${key} could not be closed; other control transport remains disabled`)
		midiState[key] = null
	}
	if (midiState.started) instance._log('info', 'MIDI service stopped')
	midiState.started = false
	midiState.lastSent = []
}

// Sends one midi-map step on the active backend. Returns true if it was sent.
function sendMidiStep(instance, step) {
	if (instance._destroyed || instance._transportSwitching || (instance.config?.controlTransport ?? 'midi') !== 'midi')
		return false
	const midiState = instance._midi
	if (!midiState?.started) return false
	const bytes = midiStepToBytes(step)
	if (!bytes) return false
	try {
		if (midiState.helper) {
			midiState.helper.stdin.write(JSON.stringify({ type: 'send', bytes }) + '\n')
		} else if (midiState.output) {
			midiState.output.sendMessage(bytes)
		} else {
			return false
		}
		_recordSent(midiState, bytes)
		instance._log('debug', 'MIDI out: sent', { bytes })
		return true
	} catch (e) {
		instance._log('error', 'MIDI out: send failed', { error: e?.message })
		return false
	}
}

module.exports = {
	startMidiService,
	stopMidiService,
	sendMidiStep,
	handleIncomingMidi,
	midiStepToBytes,
	resolveBackend,
	midiConfigSnapshot,
	helperExePath,
	DEFAULT_PORT_BASENAME,
	ECHO_SUPPRESS_MS,
	HELPER_READY_TIMEOUT_MS,
}
