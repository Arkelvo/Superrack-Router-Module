jest.mock('@julusian/midi', () => {
	const state = {
		outputs: [],
		inputs: [],
		outputPortNames: [],
		inputPortNames: [],
		failConstructor: false,
	}

	class MockPort {
		constructor(names) {
			if (state.failConstructor) throw new Error('Failed to initialise RtMidi')
			this._names = names
			this._handlers = {}
			this.openVirtualPort = jest.fn()
			this.openPort = jest.fn()
			this.closePort = jest.fn()
			this.destroy = jest.fn()
			this.sendMessage = jest.fn()
		}
		getPortCount() {
			return this._names().length
		}
		getPortName(i) {
			return this._names()[i]
		}
		on(event, cb) {
			this._handlers[event] = cb
		}
		emit(event, ...args) {
			if (this._handlers[event]) this._handlers[event](...args)
		}
	}

	class Output extends MockPort {
		constructor() {
			super(() => state.outputPortNames)
			state.outputs.push(this)
		}
	}
	class Input extends MockPort {
		constructor() {
			super(() => state.inputPortNames)
			state.inputs.push(this)
		}
	}

	return { Output, Input, __state: state }
})

jest.mock('child_process', () => {
	const spawnMock = jest.fn()
	return { spawn: spawnMock, __spawn: spawnMock }
})

const { EventEmitter } = require('events')
const fs = require('fs')
const childProcessMock = require('child_process')

function createFakeHelperProcess() {
	const child = new EventEmitter()
	child.stdout = new EventEmitter()
	child.stderr = new EventEmitter()
	child.stdin = { write: jest.fn() }
	child.kill = jest.fn()
	return child
}

const midiMock = require('@julusian/midi')
const {
	startMidiService,
	handleIncomingMidi,
	stopMidiService,
	sendMidiStep,
	midiStepToBytes,
	resolveBackend,
	midiConfigSnapshot,
	ECHO_SUPPRESS_MS,
} = require('../lib/midi-service')
const { resolveRackForChannel } = require('../lib/midi-map')

function createInstance(config = {}) {
	return {
		config: { midiEnabled: true, ...config },
		rackMap: [],
		_log: jest.fn(),
		routeRack: jest.fn().mockResolvedValue(undefined),
	}
}

function setPlatform(platform) {
	const original = Object.getOwnPropertyDescriptor(process, 'platform')
	Object.defineProperty(process, 'platform', { value: platform })
	return () => Object.defineProperty(process, 'platform', original)
}

beforeEach(() => {
	midiMock.__state.outputs.length = 0
	midiMock.__state.inputs.length = 0
	midiMock.__state.outputPortNames = []
	midiMock.__state.inputPortNames = []
	midiMock.__state.failConstructor = false
	jest.clearAllMocks()
})

describe('midiStepToBytes', () => {
	test('encodes cc on channel 1', () => {
		expect(midiStepToBytes({ type: 'cc', channel: 1, controller: 10, value: 127 })).toEqual([0xb0, 10, 127])
	})
	test('encodes noteon on channel 16', () => {
		expect(midiStepToBytes({ type: 'noteon', channel: 16, note: 64, value: 100 })).toEqual([0x9f, 64, 100])
	})
	test('encodes program change on channel 2 (two bytes)', () => {
		expect(midiStepToBytes({ type: 'program', channel: 2, program: 5 })).toEqual([0xc1, 5])
	})
	test('rejects unknown type and invalid channel', () => {
		expect(midiStepToBytes({ type: 'sysex', channel: 1 })).toBeNull()
		expect(midiStepToBytes({ type: 'cc', channel: 0, controller: 1, value: 1 })).toBeNull()
		expect(midiStepToBytes({ type: 'cc', channel: 17, controller: 1, value: 1 })).toBeNull()
		expect(midiStepToBytes(null)).toBeNull()
	})
})

describe('resolveBackend', () => {
	test('is none when MIDI is disabled', () => {
		expect(resolveBackend({ midiEnabled: false }, 'darwin')).toBe('none')
		expect(resolveBackend(undefined, 'linux')).toBe('none')
	})
	test('creates virtual ports on macOS and Linux', () => {
		expect(resolveBackend({ midiEnabled: true }, 'darwin')).toBe('rtmidi-virtual')
		expect(resolveBackend({ midiEnabled: true }, 'linux')).toBe('rtmidi-virtual')
	})
	test('prefers Windows MIDI Services on Windows, loopMIDI only on request', () => {
		expect(resolveBackend({ midiEnabled: true }, 'win32')).toBe('winmidisvc')
		expect(resolveBackend({ midiEnabled: true, midiWinBackend: 'auto' }, 'win32')).toBe('winmidisvc')
		expect(resolveBackend({ midiEnabled: true, midiWinBackend: 'loopmidi' }, 'win32')).toBe('rtmidi-open')
	})
})

describe('resolveRackForChannel', () => {
	test('resolves from array-form rackMap', () => {
		const rackMap = [null, { id: 1, value: 7 }, { id: 2, value: 9 }]
		expect(resolveRackForChannel(rackMap, 9)).toBe(2)
		expect(resolveRackForChannel(rackMap, 1)).toBeNull()
	})
	test('resolves from object-form rackMap', () => {
		const rackMap = { 1: { id: 1, value: 7 }, 2: { value: 9 } }
		expect(resolveRackForChannel(rackMap, 7)).toBe(1)
		expect(resolveRackForChannel(rackMap, 9)).toBe(2)
	})
	test('returns null for empty/invalid maps', () => {
		expect(resolveRackForChannel(null, 5)).toBeNull()
		expect(resolveRackForChannel([], 5)).toBeNull()
	})
})

describe('startMidiService (virtual backend)', () => {
	let restorePlatform
	beforeEach(() => {
		restorePlatform = setPlatform('linux')
	})
	afterEach(() => restorePlatform())

	test('creates virtual in/out ports with configured base name', async () => {
		const instance = createInstance({ midiPortName: 'My Router' })
		await startMidiService(instance)
		expect(instance._midi.started).toBe(true)
		expect(instance._midi.backend).toBe('rtmidi-virtual')
		expect(midiMock.__state.outputs[0].openVirtualPort).toHaveBeenCalledWith('My Router Out')
		expect(midiMock.__state.inputs[0].openVirtualPort).toHaveBeenCalledWith('My Router In')
	})

	test('stays in variables-only mode when disabled', async () => {
		const instance = createInstance({ midiEnabled: false })
		await startMidiService(instance)
		expect(instance._midi.started).toBe(false)
		expect(instance._midi.backend).toBe('none')
		expect(midiMock.__state.outputs).toHaveLength(0)
	})

	test('falls back to variables-only mode when RtMidi init fails', async () => {
		midiMock.__state.failConstructor = true
		const instance = createInstance()
		await startMidiService(instance)
		expect(instance._midi.started).toBe(false)
		expect(instance._log).toHaveBeenCalledWith('error', expect.stringContaining('failed to start'), expect.anything())
	})

	test('is idempotent while running', async () => {
		const instance = createInstance()
		await startMidiService(instance)
		await startMidiService(instance)
		expect(midiMock.__state.outputs).toHaveLength(1)
	})

	test('partial startup retains an output handle if cleanup fails and prevents later switch', async () => {
		const OriginalInput = midiMock.Input
		const inputSpy = jest.spyOn(midiMock, 'Input').mockImplementation(() => {
			const input = new OriginalInput()
			input.openVirtualPort.mockImplementation(() => {
				throw new Error('input failed')
			})
			const output = midiMock.__state.outputs[0]
			output.closePort.mockImplementation(() => {
				throw new Error('busy')
			})
			output.destroy.mockImplementation(() => {
				throw new Error('busy')
			})
			return input
		})
		try {
			const instance = createInstance()
			await expect(startMidiService(instance)).rejects.toThrow(/MIDI port/)
			expect(instance._midi.output).toBe(midiMock.__state.outputs[0])
			instance.config.controlTransport = 'prolink'
			await expect(stopMidiService(instance)).rejects.toThrow(/MIDI port/)
		} finally {
			inputSpy.mockRestore()
		}
	})
})

describe('startMidiService (Windows open-by-name backend)', () => {
	let restorePlatform
	beforeEach(() => {
		restorePlatform = setPlatform('win32')
	})
	afterEach(() => restorePlatform())

	test('opens existing loopMIDI ports matched by name', async () => {
		midiMock.__state.outputPortNames = ['Microsoft GS Wavetable', 'SuperRack Router 1']
		midiMock.__state.inputPortNames = ['SuperRack Router 1']
		const instance = createInstance()
		await startMidiService(instance)
		expect(instance._midi.started).toBe(true)
		expect(midiMock.__state.outputs[0].openPort).toHaveBeenCalledWith(1)
		expect(midiMock.__state.inputs[0].openPort).toHaveBeenCalledWith(0)
	})

	test('logs an error and stays stopped when no port matches', async () => {
		midiMock.__state.outputPortNames = ['Microsoft GS Wavetable']
		midiMock.__state.inputPortNames = []
		const instance = createInstance()
		await startMidiService(instance)
		expect(instance._midi.started).toBe(false)
		expect(instance._log).toHaveBeenCalledWith('error', expect.stringContaining('loopMIDI'), expect.anything())
		expect(midiMock.__state.outputs[0].destroy).toHaveBeenCalled()
	})
})

describe('startMidiService (Windows MIDI Services helper backend)', () => {
	let restorePlatform
	let existsSpy
	beforeEach(() => {
		restorePlatform = setPlatform('win32')
		existsSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true)
	})
	afterEach(() => {
		restorePlatform()
		existsSpy.mockRestore()
	})

	function startWithHelper(instance) {
		const child = createFakeHelperProcess()
		childProcessMock.__spawn.mockReturnValue(child)
		const startPromise = startMidiService(instance)
		child.stdout.emit('data', JSON.stringify({ type: 'ready', endpointId: 'SWD:TEST' }) + '\n')
		return startPromise.then(() => child)
	}

	test('spawns the helper and comes online after the ready handshake', async () => {
		const instance = createInstance({ midiPortName: 'SuperRack Router' })
		const child = await startWithHelper(instance)
		expect(childProcessMock.__spawn).toHaveBeenCalledWith(
			expect.stringContaining('SuperRackMidiHelper.exe'),
			['--name', 'SuperRack Router'],
			expect.objectContaining({ windowsHide: true }),
		)
		expect(instance._midi.started).toBe(true)
		expect(instance._midi.backend).toBe('winmidisvc')
		expect(instance._midi.helper).toBe(child)
	})

	test('uses a configured helper path', async () => {
		const instance = createInstance({ midiHelperPath: 'C:\\tools\\SuperRackMidiHelper.exe' })
		await startWithHelper(instance)
		expect(childProcessMock.__spawn).toHaveBeenCalledWith(
			'C:\\tools\\SuperRackMidiHelper.exe',
			expect.anything(),
			expect.anything(),
		)
	})

	test('sendMidiStep writes ndjson to the helper stdin', async () => {
		const instance = createInstance()
		const child = await startWithHelper(instance)
		const ok = sendMidiStep(instance, { type: 'cc', channel: 1, controller: 20, value: 64 })
		expect(ok).toBe(true)
		expect(child.stdin.write).toHaveBeenCalledWith(JSON.stringify({ type: 'send', bytes: [0xb0, 20, 64] }) + '\n')
	})

	test('incoming helper midi messages trigger rack routing', async () => {
		const instance = createInstance({ midiInChannel: 1, midiInController: 1 })
		instance.rackMap = [null, { id: 1, value: 5 }]
		const child = await startWithHelper(instance)
		child.stdout.emit('data', JSON.stringify({ type: 'midi', bytes: [0xb0, 1, 5] }) + '\n')
		expect(instance.routeRack).toHaveBeenCalledWith(1)
	})

	test('falls back to the loopMIDI backend when the helper exe is missing', async () => {
		existsSpy.mockReturnValue(false)
		midiMock.__state.outputPortNames = ['SuperRack Router 1']
		midiMock.__state.inputPortNames = ['SuperRack Router 1']
		const instance = createInstance()
		await startMidiService(instance)
		expect(childProcessMock.__spawn).not.toHaveBeenCalled()
		expect(instance._midi.backend).toBe('rtmidi-open')
		expect(instance._midi.started).toBe(true)
	})

	test('falls back to the loopMIDI backend when the helper reports an error and exits', async () => {
		const child = createFakeHelperProcess()
		childProcessMock.__spawn.mockReturnValue(child)
		midiMock.__state.outputPortNames = ['SuperRack Router 1']
		midiMock.__state.inputPortNames = ['SuperRack Router 1']
		const instance = createInstance()
		const startPromise = startMidiService(instance)
		child.stdout.emit('data', JSON.stringify({ type: 'error', message: 'SDK runtime not found' }) + '\n')
		child.emit('exit', 2)
		await startPromise
		expect(instance._log).toHaveBeenCalledWith('error', expect.stringContaining('SDK runtime not found'))
		expect(instance._midi.backend).toBe('rtmidi-open')
		expect(instance._midi.started).toBe(true)
	})

	test('stopMidiService asks the helper to quit', async () => {
		const instance = createInstance()
		const child = await startWithHelper(instance)
		let stopped = false
		const stopping = stopMidiService(instance).then(() => {
			stopped = true
		})
		await Promise.resolve()
		expect(stopped).toBe(false)
		child.emit('exit', 0)
		await stopping
		expect(child.stdin.write).toHaveBeenCalledWith(JSON.stringify({ type: 'quit' }) + '\n')
		expect(instance._midi.started).toBe(false)
		expect(instance._midi.helper).toBeNull()
	})

	test('unresponsive helper prevents switch completion even after kill request', async () => {
		jest.useFakeTimers()
		try {
			const instance = createInstance()
			const child = await startWithHelper(instance)
			const stopping = stopMidiService(instance)
			const rejected = expect(stopping).rejects.toThrow(/did not exit/)
			await jest.advanceTimersByTimeAsync(3000)
			await rejected
			expect(child.kill).toHaveBeenCalled()
			expect(instance._midi.helper).toBe(child)
			child.emit('exit', 0)
		} finally {
			jest.useRealTimers()
		}
	})
})

describe('sendMidiStep', () => {
	let restorePlatform
	beforeEach(() => {
		restorePlatform = setPlatform('linux')
	})
	afterEach(() => restorePlatform())

	test('sends encoded bytes on the output port', async () => {
		const instance = createInstance()
		await startMidiService(instance)
		const ok = sendMidiStep(instance, { type: 'cc', channel: 1, controller: 20, value: 64 })
		expect(ok).toBe(true)
		expect(instance._midi.output.sendMessage).toHaveBeenCalledWith([0xb0, 20, 64])
	})

	test('returns false when the service is not running', () => {
		const instance = createInstance({ midiEnabled: false })
		expect(sendMidiStep(instance, { type: 'cc', channel: 1, controller: 1, value: 1 })).toBe(false)
	})
})

describe('incoming MIDI trigger mapping', () => {
	let restorePlatform
	beforeEach(() => {
		restorePlatform = setPlatform('linux')
	})
	afterEach(() => restorePlatform())

	test('routes the rack mapped to the CC value', async () => {
		const instance = createInstance({ midiInChannel: 1, midiInController: 1 })
		instance.rackMap = [null, { id: 1, value: 5 }, { id: 2, value: 6 }]
		await startMidiService(instance)
		midiMock.__state.inputs[0].emit('message', 0, [0xb0, 1, 6])
		expect(instance.routeRack).toHaveBeenCalledWith(2)
	})

	test('ignores CC on other channels or controllers', async () => {
		const instance = createInstance({ midiInChannel: 2, midiInController: 10 })
		instance.rackMap = [null, { id: 1, value: 5 }]
		await startMidiService(instance)
		midiMock.__state.inputs[0].emit('message', 0, [0xb0, 10, 5]) // channel 1, not 2
		midiMock.__state.inputs[0].emit('message', 0, [0xb1, 11, 5]) // wrong controller
		expect(instance.routeRack).not.toHaveBeenCalled()
	})

	test('warns when no rack is mapped to the value', async () => {
		const instance = createInstance({ midiInChannel: 1, midiInController: 1 })
		instance.rackMap = []
		await startMidiService(instance)
		midiMock.__state.inputs[0].emit('message', 0, [0xb0, 1, 99])
		expect(instance.routeRack).not.toHaveBeenCalled()
		expect(instance._log).toHaveBeenCalledWith('warn', expect.stringContaining('no rack mapped'), expect.anything())
	})

	test('suppresses echoes of just-sent messages', async () => {
		const instance = createInstance({ midiInChannel: 1, midiInController: 1 })
		instance.rackMap = [null, { id: 1, value: 5 }]
		await startMidiService(instance)
		sendMidiStep(instance, { type: 'cc', channel: 1, controller: 1, value: 5 })
		midiMock.__state.inputs[0].emit('message', 0, [0xb0, 1, 5])
		expect(instance.routeRack).not.toHaveBeenCalled()

		// after the suppression window the same message triggers again
		instance._midi.lastSent[0].ts = Date.now() - ECHO_SUPPRESS_MS - 1
		midiMock.__state.inputs[0].emit('message', 0, [0xb0, 1, 5])
		expect(instance.routeRack).toHaveBeenCalledWith(1)
	})
})

describe('stopMidiService', () => {
	let restorePlatform
	beforeEach(() => {
		restorePlatform = setPlatform('linux')
	})
	afterEach(() => restorePlatform())

	test('closes and destroys both ports', async () => {
		const instance = createInstance()
		await startMidiService(instance)
		const output = midiMock.__state.outputs[0]
		const input = midiMock.__state.inputs[0]
		await stopMidiService(instance)
		expect(instance._midi.started).toBe(false)
		expect(output.closePort).toHaveBeenCalled()
		expect(output.destroy).toHaveBeenCalled()
		expect(input.closePort).toHaveBeenCalled()
		expect(input.destroy).toHaveBeenCalled()
	})

	test('is safe to call when never started', async () => {
		const instance = createInstance({ midiEnabled: false })
		await expect(stopMidiService(instance)).resolves.toBeUndefined()
	})
	test('failure to close and destroy a port blocks transport switching', async () => {
		const instance = createInstance()
		await startMidiService(instance)
		const input = midiMock.__state.inputs[0]
		input.closePort.mockImplementation(() => {
			throw new Error('busy')
		})
		input.destroy.mockImplementation(() => {
			throw new Error('busy')
		})
		await expect(stopMidiService(instance)).rejects.toThrow(/MIDI port/)
		expect(instance._midi.input).toBe(input)
	})
})

test('ProLink disables native MIDI backend and blocks late input/output callbacks', async () => {
	const instance = createInstance({ controlTransport: 'prolink', midiEnabled: true })
	expect(resolveBackend(instance.config, 'win32')).toBe('none')
	await startMidiService(instance)
	expect(instance._midi.started).toBe(false)
	instance._midi.started = true
	instance._midi.output = { sendMessage: jest.fn() }
	instance.rackMap = [null, { id: 1, value: 5 }]
	handleIncomingMidi(instance, [0xb0, 1, 5])
	expect(instance.routeRack).not.toHaveBeenCalled()
	expect(sendMidiStep(instance, { type: 'cc', channel: 1, controller: 1, value: 5 })).toBe(false)
	expect(instance._midi.output.sendMessage).not.toHaveBeenCalled()
})

describe('midiConfigSnapshot', () => {
	test('changes only when MIDI-relevant fields change', () => {
		const a = midiConfigSnapshot({
			midiEnabled: true,
			midiPortName: 'X',
			midiInChannel: 1,
			midiInController: 1,
			logLevel: 'debug',
		})
		const b = midiConfigSnapshot({
			midiEnabled: true,
			midiPortName: 'X',
			midiInChannel: 1,
			midiInController: 1,
			logLevel: 'error',
		})
		const c = midiConfigSnapshot({ midiEnabled: true, midiPortName: 'Y', midiInChannel: 1, midiInController: 1 })
		expect(a).toBe(b)
		expect(a).not.toBe(c)
	})
})
