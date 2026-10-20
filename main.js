const { InstanceBase, runEntrypoint, InstanceStatus } = require('@companion-module/base')
const UpgradeScripts = require('./upgrades')
const UpdateActions = require('./actions')
const UpdateFeedbacks = require('./feedbacks')
const UpdateVariableDefinitions = require('./variables')
const defaults = require('./default-variables')
const { startHttpServer, stopHttpServer } = require('./ui/http')
const { applyMidiStepToVariables } = require('./lib/midi-map')
const { decodeOsc } = require('./lib/prolink-osc')
const { ProLinkService } = require('./lib/prolink-service')
const { ProLinkObservations } = require('./lib/prolink-observations')
const os = require('os')
const {
	startMidiService,
	stopMidiService,
	sendMidiStep,
	midiConfigSnapshot,
	DEFAULT_PORT_BASENAME,
} = require('./lib/midi-service')

const MIDI_STEP_DELAY_MS = 50

class ModuleInstance extends InstanceBase {
	constructor(internal) {
		super(internal)
		this.state = {
			activeSourceIndex: null,
			activeSourceLabel: '',
			lastRoutedRacks: [],
			lastActionTimestamp: 0,
			failedStepsTotal: 0,
			sequenceRunning: false,
			sequenceStartTs: 0,
			sequenceTimeoutMs: 1000,
		}
		this.rackCount = defaults.rackCount
		this.channelCount = defaults.channelCount
		this.hotMap = defaults.hotMap
		this.emptyMapping = defaults.mapping(this.rackCount)
		this.rackMap = this.emptyMapping
		this.hotPlugin = defaults.hotPlugin
		this.hotSnapshot = defaults.hotSnapshot

		this.logLevel = defaults.logLevel ?? 'error'
		this._http = defaults.httpSettings
		this._midi = { started: false, restarting: false, backend: 'none', input: null, output: null, lastSent: [] }
		this._controlGeneration = 0
		this._prolinkReady = false
		this._transportOperations = Promise.resolve()
		this._transportRevision = 0
		this._prolink = new ProLinkService((state, error) => this._prolinkStateChanged(state, error))
		this._prolinkObservations = new ProLinkObservations(this)
		// Handle observations independently from the existing onDebugFrame logger.
		// Raw/decoded debug logging below remains intact.
		this._prolink.onFrame = (frame) => this._prolinkObservations.receive(frame)
		this._prolink.onFrameError = (error) =>
			this._log('warn', '[PROLINK_FRAME_ERROR]', { error: error.message })


		this._prolink.onDebugFrame = (frame) => {
			if (this.logLevel !== 'debug') return
			if (frame.type !== 5) return

			let message

			try {
				message = decodeOsc(frame.payload)
			} catch (error) {
				this._log('debug', '[PROLINK_RX_RAW]', {
					error: error.message,
					hex: frame.payload.toString('hex').slice(0, 1024),
				})
				return
			}

			const { path, args } = message

			// ProLinkObservations already logs controller changes once per distinct value.
			// Keep decoding these packets; suppress only the repetitive raw debug output.
			if (
				path === '/waves.com/remote/NotifyControllerProperties' ||
				path === '/waves.com/remote/NotifyControllerValue'
			) return

			// Touch & Turn: Nur bei tatsächlicher Änderung loggen
			if (path.endsWith('/NotifyTouchAndTurnControlOwnership')) {
				const value = args[0]

				if (this._lastTouchOwnership === value) return
				this._lastTouchOwnership = value

				this._log('debug', '[PROLINK_TOUCH_OWNERSHIP]', {
					value,
				})
				return
			}

			// Vollständige Rack-Konfiguration
			if (path.endsWith('/NotifyRacksConfigChanged')) {
				const [count, ...rows] = args

				if (
					count !== rows.length ||
					!rows.every(r => Array.isArray(r) && r.length === 11)
				) {
					this._log('warn', 'Unexpected rack configuration format')
					return
				}

				const current = new Map(
					rows.map(row => [row[0], row])
				)

				const fields = [
					'id', 'name',
					'int1', 'int2', 'int3',
					'int4', 'int5', 'int6',
					'bool1', 'bool2', 'int7'
				]

				if (!this._lastRackConfig) {
					this._log('debug', '[PROLINK_RACK_NAMES]',
						rows.map(r => ({
							rack: r[0] + 1,
							name: r[1]
						}))
					)
				} else {
					for (const row of rows) {
						const previous = this._lastRackConfig.get(row[0])

						if (!previous) continue

						const changes = row.flatMap((value, index) =>
							Object.is(value, previous[index])
								? []
								: [{
									field: fields[index],
									from: previous[index],
									to: value
								}]
						)
						
						if (changes.length > 0) {
							this._log('debug', '[PROLINK_RACK_CHANGED]', {
								rack: row[0] + 1,
								name: row[1],
								changes
							})
						}
					}
				}

				this._lastRackConfig = current
				return
			}


			if (path === '/waves.com/remote/ResultCommand') {
				const [sequence, resultCode, resultText] = args

				this._log('debug', '[PROLINK_COMMAND_RESULT]', {
					sequence,
					resultCode,
					resultText
				})

				this.setVariableValues({
					prolink_last_ack_sequence: sequence,
					prolink_last_result: resultCode,
					prolink_last_result_text: resultText
				})

				return
			}

			// Andere OSC-Nachrichten
			this._log('debug', '[PROLINK_RX]', {
				path,
				args
			})
		}
	}

	// Companion lifecycle method: Called when the module is initialized
	async init(config) {
		this.config = config
		this._applyConfigToLocalScopes()
		this._log(
			'info',
			`Module initialized, logLevel=${this.logLevel}, rackCount=${this.rackCount}, channelCount=${this.channelCount}`,
		)
		this.updateActions()
		this.updateFeedbacks()
		this.updateVariableDefinitions()
		this.updateStatus(InstanceStatus.Ok)
		await startHttpServer(this)
		await this._configureTransport()
	}

	// Companion lifecycle method: Called when the module is destroyed
	async destroy() {
		this._log('debug', 'destroy start')
		this.state.sequenceRunning = false
		this._destroyed = true
		this._controlGeneration++
		this._prolinkReady = false
		this._prolinkObservations?.reset()
		this._transportRevision++
		this._transportSwitching = true
		await this._transportOperations
		await this._prolink.stop()
		await stopMidiService(this)
		await stopHttpServer(this)
		this._log('debug', 'destroy done')
	}

	// Companion lifecycle method: Called when the configuration is updated
	async configUpdated(config) {
		this.config = config
		this._applyConfigToLocalScopes(true)
		await this._configureTransport()
		try {
			this.updateActions()
		} catch {}
		try {
			this.updateFeedbacks()
		} catch {}
		try {
			this.updateVariableDefinitions()
		} catch {}
		this._log('info', `CONFIG_UPDATED completed`, {
			logLevel: this.logLevel,
			hasRackMap: !!this.rackMap,
			racksLength: this.config?.racks?.length,
		})
		const desiredPort = parseInt(this.config?.http?.port, 10)
		if (Number.isInteger(desiredPort) && desiredPort !== this._http.port) {
			this._log('info', 'HTTP port change detected', { from: this._http.port, to: desiredPort })
			if (this._http.restarting) {
				this._log('debug', 'HTTP restart already in progress')
				return
			}
			this._http.restarting = true
			try {
				await stopHttpServer(this)
				this._http.port = desiredPort
				await startHttpServer(this)
			} catch (err) {
				this._log('error', 'Failed to restart HTTP server', { error: err?.message })
				this.updateStatus(InstanceStatus.Error)
			} finally {
				this._http.restarting = false
			}
		}
	}

	// Companion lifecycle method: Defines the configuration fields for the module
	getConfigFields() {
		this.config = this.config || {}

		const fields = [
			{
				type: 'static-text',
				id: 'info_intro',
				label: 'Info',
				value:
					'Select MIDI (variables and optional native ports) or ProLink for rack selection. The built-in <a href="http://127.0.0.1:' +
					(this._http?.port ?? '') +
					'/patch" target="_blank" rel="noopener noreferrer">routepatch</a> UI is served by this module on the configured HTTP port (default ' +
					(this._http?.port ?? '') +
					').',
			},
			{
				type: 'dropdown',
				id: 'controlTransport',
				label: 'Control transport: MIDI OR ProLink',
				tooltip:
					'Only the selected service runs. ProLink stops all native MIDI ports and the MIDI helper, including MIDI input.',
				default: 'midi',
				choices: [
					{ id: 'midi', label: 'MIDI (legacy)' },
					{ id: 'prolink', label: 'ProLink (experimental)' },
				],
			},
			{
				type: 'dropdown',
				id: 'prolinkInterface',
				label: 'ProLink network interface',
				default: '',
				choices: [
					{ id: '', label: 'Select an IPv6 link-local interface' },
					...Object.entries(os.networkInterfaces()).map(([id, addresses]) => ({
						id,
						label: `${id}: ${
							(addresses || [])
								.filter((a) => a.family === 'IPv6' || a.family === 6)
								.map((a) => a.address)
								.join(', ') || 'no IPv6'
						}`,
					})),
				],
			},
			{
				type: 'textinput',
				id: 'prolinkName',
				label: 'ProLink discovery name',
				default: 'Mixing Station',
				tooltip: 'Original compatibility identity. Custom names and multiple instances require live testing.',
			},
			{
				type: 'checkbox',
				id: 'prolinkRecallEnabled',
				label: 'Allow explicit ProLink snapshot recall actions',
				default: false,
			},
			{
				type: 'checkbox',
				id: 'prolinkHighlightEnabled',
				label: 'Allow explicit ProLink snapshot highlight actions',
				default: false,
			},
			{
				type: 'dropdown',
				id: 'logLevel',
				label: 'Log level',
				choices: [
					{ id: 'error', label: 'error' },
					{ id: 'warn', label: 'warn' },
					{ id: 'info', label: 'info' },
					{ id: 'debug', label: 'debug' },
				],
				default: this.logLevel,
			},
			{
				type: 'dropdown',
				id: 'rackCount',
				label: 'Rack count',
				choices: [
					{ id: 64, label: '64' },
					{ id: 32, label: '32' },
					{ id: 16, label: '16' },
					{ id: 8, label: '8' },
					{ id: 4, label: '4' },
				],
				default: this.rackCount,
			},
			{
				type: 'number',
				id: 'channelCount',
				label: 'Channel count',
				min: 32,
				max: 512,
				default: this.channelCount,
				tooltip: 'Number of channels (min 32, max 512)',
			},
			{
				type: 'number',
				id: 'http.port',
				label: 'HTTP Port',
				min: 1,
				max: 65535,
				default: this._http.port,
				tooltip: 'Port for the Fastify HTTP server',
			},
			{
				type: 'static-text',
				id: 'info_midi',
				label: 'Native MIDI',
				value:
					'Optional: open native MIDI ports so DAWs and Waves SuperRack can talk to this module directly. ' +
					'On macOS/Linux virtual ports are created automatically. On Windows 11 24H2+ a virtual device is registered via ' +
					'Windows MIDI Services (helper required, see HELP); otherwise a loopMIDI port matching the name below is used.',
			},
			{
				type: 'checkbox',
				id: 'midiEnabled',
				label: 'Enable native MIDI ports (MIDI mode only)',
				default: false,
			},
			{
				type: 'textinput',
				id: 'midiPortName',
				label: 'MIDI port name',
				default: DEFAULT_PORT_BASENAME,
				tooltip:
					'Base name of the MIDI ports ("<name> In" / "<name> Out"). On Windows this is matched against existing loopMIDI ports.',
			},
			{
				type: 'dropdown',
				id: 'midiWinBackend',
				label: 'Windows MIDI backend',
				choices: [
					{ id: 'auto', label: 'Windows MIDI Services (fallback: loopMIDI)' },
					{ id: 'loopmidi', label: 'loopMIDI only' },
				],
				default: 'auto',
				tooltip:
					'Windows only. "Windows MIDI Services" registers a real virtual device (Win11 24H2+, helper required).',
			},
			{
				type: 'textinput',
				id: 'midiHelperPath',
				label: 'Windows MIDI helper path (optional)',
				default: '',
				tooltip: 'Full path to SuperRackMidiHelper.exe. Leave empty to use the bundled helper/dist/win-x64 location.',
			},
			{
				type: 'number',
				id: 'midiInChannel',
				label: 'MIDI-in trigger channel (1-16)',
				min: 1,
				max: 16,
				default: 1,
				tooltip: 'Incoming CC messages on this MIDI channel trigger rack routing.',
			},
			{
				type: 'number',
				id: 'midiInController',
				label: 'MIDI-in trigger CC number (0-127)',
				min: 0,
				max: 127,
				default: 1,
				tooltip:
					'CC number whose value is interpreted as the mixer channel to route (same semantics as the Trigger Channel action).',
			},
		]
		return fields.map((field) => {
			if (field.id.startsWith('prolink')) field.isVisible = (config) => config.controlTransport === 'prolink'
			if (field.id.startsWith('midi') || field.id === 'info_midi')
				field.isVisible = (config) => (config.controlTransport ?? 'midi') === 'midi'
			return field
		})
	}

	_applyConfigToLocalScopes(preventConfigReupdate = false) {
		// Invalidate delayed MIDI steps on any configuration change.
		this._controlGeneration++
		let changed = false

		const newLogLevel = this.config?.logLevel || 'error'
		if (newLogLevel !== this.logLevel) {
			this.logLevel = newLogLevel
			changed = true
		}

		const desiredHttpPort = this.config?.http?.port || this._http.port
		if (desiredHttpPort !== this._http.port) {
			this._http.port = desiredHttpPort
			changed = true
		}

		const mrRaw = this.config?.rackCount
		const mr = parseInt(mrRaw, 10)
		if ([64, 32, 16, 8, 4].includes(mr) && mr !== this.rackCount) {
			this.rackCount = mr
			changed = true
		}

		// channelCount: clamp [32,512]
		const chCountRaw = this.config?.channelCount
		const chParsed = parseInt(chCountRaw, 10)
		let clamped = this.channelCount
		if (Number.isInteger(chParsed)) {
			clamped = Math.min(512, Math.max(32, chParsed))
		}
		if (clamped !== this.channelCount) {
			this.channelCount = clamped
			changed = true
		}

		// Sync rackMap from persisted config (HTTP handler stores under config.racks)
		if (Array.isArray(this.config?.racks) && this.config.racks.length > 0) {
			this.rackMap = this.config.racks
		}

		if (this.config?.hotPlugin && this.config.hotPlugin !== {}) {
			this.hotPlugin = this.config.hotPlugin
		}

		if (this.config?.hotSnapshot && this.config.hotSnapshot !== {}) {
			this.hotSnapshot = this.config.hotSnapshot
		}

		if (!preventConfigReupdate && changed) {
			this.saveConfig(this.config)
		}

		this._log('info', `APPLY_CONFIG completed`, { logLevel: this.logLevel, hasRackMap: !!this.rackMap })
	}

	updateActions() {
		try {
			if (typeof UpdateActions === 'function') {
				UpdateActions(this)
			}
		} catch (e) {
			this._log('error', 'updateActions failed', { error: e?.message })
		}
	}

	updateFeedbacks() {
		try {
			if (typeof UpdateFeedbacks === 'function') {
				UpdateFeedbacks(this)
			}
		} catch (e) {
			this._log('error', 'updateFeedbacks failed', { error: e?.message })
		}
	}

	updateVariableDefinitions() {
		try {
			if (typeof UpdateVariableDefinitions === 'function') {
				UpdateVariableDefinitions(this)
			}
		} catch (e) {
			this._log('error', 'updateVariableDefinitions failed', { error: e?.message })
		}
	}

	_sendMidiStep(step) {
		if (this._destroyed || this._transportSwitching || this._transport() !== 'midi') return
		// Statt direkt zu senden: Variablen setzen, von Generic-MIDI aus nutzbar
		const ch = step.channel
		let controller = ''
		let value = ''
		let status = ''
		if (step.type === 'cc') {
			status = 'cc'
			controller = String(step.controller)
			value = String(step.value)
		} else if (step.type === 'noteon') {
			status = 'noteon'
			controller = String(step.note)
			value = String(step.value)
		} else if (step.type === 'program') {
			status = 'program'
			controller = String(step.program)
			value = ''
		} else {
			this._log('warn', 'unknown MIDI Type', { type: step.type })
			return
		}
		this.setVariableValues({
			midi_last_type: status,
			midi_last_channel: ch,
			midi_last_controller: controller,
			midi_last_value: value,
			last_action_timestamp: Date.now(),
		})
		sendMidiStep(this, step)
		this._log('debug', 'MIDI step prepared', { status, ch, controller, value })
	}

	_shouldLog(level) {
		const order = ['error', 'warn', 'info', 'debug']
		return order.indexOf(level) <= order.indexOf(this.logLevel)
	}

	_log(level, msg, data) {
		if (!this._shouldLog(level)) return
		const line = msg + (data ? ` ${JSON.stringify(data)}` : '')
		this.log(level, line)
	}

	// Liefert die MIDI-Sequenz für ein Rack über hotMap
	getMidiSequenceForRack(rackId) {
		const entry = this.hotMap.find((e) => String(e.rack) === String(rackId))
		if (!entry) return null
		const pluginStep = this.hotPlugin?.mapping?.find((p) => p && p.id === entry.plugin)
		const snapshotStep = this.hotSnapshot?.mapping?.find((s) => s && s.id === entry.snapshot)
		if (!pluginStep || !snapshotStep) return null
		return [
			{
				type: this.hotSnapshot.type,
				channel: this.hotSnapshot.channel,
				controller: snapshotStep.id,
				value: snapshotStep.value,
				delay: 0,
			},
			{
				type: this.hotPlugin.type,
				channel: this.hotPlugin.channel,
				controller: pluginStep.id,
				value: pluginStep.value,
				delay: 0,
			},
		]
	}

	// Liefert die MIDI-Sequenz für einen Hot Snapshot
	getMidiSequenceForSnapshot(snapshotId) {
		const entry = this.hotMap.find((e) => String(e.snapshot) === String(snapshotId))
		if (!entry) return null
		const snapshotStep = this.hotSnapshot?.mapping?.find((s) => s && s.id === entry.snapshot)
		if (!snapshotStep) return null
		return [
			{
				type: this.hotSnapshot.type,
				channel: this.hotSnapshot.channel,
				controller: snapshotStep.id,
				value: snapshotStep.value,
				delay: 0,
			},
		]
	}

	// Liefert die MIDI-Sequenz für ein Hot Plugin
	getMidiSequenceForPlugin(pluginId) {
		const entry = this.hotMap.find((e) => String(e.plugin) === String(pluginId))
		if (!entry) return null
		const pluginStep = this.hotPlugin?.mapping?.find((p) => p && p.id === entry.plugin)
		if (!pluginStep) return null
		return [
			{
				type: this.hotPlugin.type,
				channel: this.hotPlugin.channel,
				controller: pluginStep.id,
				value: pluginStep.value,
				delay: 0,
			},
		]
	}

	// --- Routing Actions ---
	async routeRack(rackId) {
		if (this._destroyed) return false
		if (this._transportSwitching) return this._controlFailure('Control transport is switching; command was not queued')
		if (this._transport() !== 'midi') {
			if (rackId === 0 || rackId === '0') return false
			const number = this._prolinkId(rackId, 1, Math.min(this.rackCount, 64))
			if (number === null) return this._controlFailure('Invalid ProLink rack number')
			if (!this._sendProlink('ShowRackByID', number - 1)) return false
			this.state.lastRoutedRacks = [number, ...this.state.lastRoutedRacks.filter((id) => Number(id) !== number)].slice(
				0,
				8,
			)
			this._updateVariables()
			this.checkFeedbacks?.('rack_last_used')
			return true
		}
		this.state.sequenceRunning = true
		this.state.sequenceStartTs = Date.now()
		try {
			if ((await this._executeRackSequence(rackId)) === false) return false
			this.state.lastRoutedRacks = [rackId, ...(this.state.lastRoutedRacks || []).filter((id) => id !== rackId)].slice(
				0,
				8,
			)
		} finally {
			this.state.sequenceRunning = false
			this._updateVariables()
		}
	}

	async routeSnapshot(snapshotId) {
		if (this._destroyed) return false
		if (this._transportSwitching) return this._controlFailure('Control transport is switching; command was not queued')
		if (this._transport() !== 'midi')
			return this._controlFailure(
				'Hot Snapshot is a MIDI slot; use the explicit ProLink snapshot action with a provider ID',
			)
		this.state.sequenceRunning = true
		this.state.sequenceStartTs = Date.now()
		try {
			await this._executeSnapshotSequence(snapshotId)
		} finally {
			this.state.sequenceRunning = false
			this._updateVariables()
		}
	}

	async routePlugin(pluginId) {
		if (this._destroyed) return false
		if (this._transportSwitching) return this._controlFailure('Control transport is switching; command was not queued')
		if (this._transport() !== 'midi')
			return this._controlFailure('Hot Plugin is not supported by ProLink; no MIDI fallback was sent')
		this.state.sequenceRunning = true
		this.state.sequenceStartTs = Date.now()
		try {
			await this._executePluginSequence(pluginId)
		} finally {
			this.state.sequenceRunning = false
			this._updateVariables()
		}
	}

	async _executeSequence(steps, logContext) {
		const generation = this._controlGeneration
		if (!steps) {
			this._log('warn', `${logContext.type} not found in hotMap`, logContext)
			return
		}
		this._log('info', `${logContext.type} sequence started`, { ...logContext, steps: steps.length })
		this.state.sequenceStartTs = Date.now()
		for (const step of steps) {
			if (
				this._destroyed ||
				this._transportSwitching ||
				generation !== this._controlGeneration ||
				this._transport() !== 'midi'
			)
				return false
			if (Date.now() - this.state.sequenceStartTs > this.state.sequenceTimeoutMs) {
				this._log('error', `timeout during ${logContext.type} sequence`, logContext)
				this.state.failedStepsTotal++
				this._updateVariables()
				return
			}
			try {
				applyMidiStepToVariables(this, step)
				sendMidiStep(this, step)
				this.state.lastActionTimestamp = Date.now()
				this._updateVariables({ setActionTimestamp: true })
			} catch (e) {
				this._log('error', 'midi step error', { ...logContext, error: e.message })
				this.state.failedStepsTotal++
				this._updateVariables()
			}
			const totalDelay = (step.delay > 0 ? step.delay : 0) + MIDI_STEP_DELAY_MS
			if (totalDelay > 0) await new Promise((res) => setTimeout(res, totalDelay))
		}
		if (this._destroyed || generation !== this._controlGeneration) return false
		this._log('info', `ended ${logContext.type} sequence`, logContext)
	}

	async _executeRackSequence(rackId) {
		const steps = this.getMidiSequenceForRack(rackId)
		return this._executeSequence(steps, { type: 'rack', rackId })
	}

	async _executeSnapshotSequence(snapshotId) {
		const steps = this.getMidiSequenceForSnapshot(snapshotId)
		await this._executeSequence(steps, { type: 'snapshot', snapshotId })
	}

	async _executePluginSequence(pluginId) {
		const steps = this.getMidiSequenceForPlugin(pluginId)
		await this._executeSequence(steps, { type: 'plugin', pluginId })
	}

	_updateVariables(opts = {}) {
		const values = {
			last_routed_racks: JSON.stringify(this.state.lastRoutedRacks || []),
			failed_steps_total: this.state.failedStepsTotal,
			active_source_index: this.state.activeSourceIndex,
			active_source_label: this.state.activeSourceLabel,
		}
		if (opts.setActionTimestamp) {
			values.last_action_timestamp = this.state.lastActionTimestamp
		}
		this.setVariableValues(values)
	}

	_buildRackChoices() {
		if (this._transport() === 'prolink')
			return Array.from({ length: this.rackCount }, (_, i) => ({
				id: String(i + 1),
				label: this._prolinkObservations?.racks.get(i + 1)?.name || `Rack ${i + 1}`,
			}))
		return this.hotMap.map((entry) => ({
			id: String(entry.rack),
			label: `Rack ${entry.rack} (Plugin ${entry.plugin}, Snapshot ${entry.snapshot})`,
		}))
	}

	_buildHotSnapshotChoices() {
		// IDs 1–6
		return Array.from({ length: 6 }, (_, i) => ({ id: String(i + 1), label: `Hot Snapshot ${i + 1}` }))
	}

	_buildHotPluginChoices() {
		// IDs 1–12
		return Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1), label: `Hot Plugin ${i + 1}` }))
	}

	_transport() {
		return this.config?.controlTransport ?? 'midi'
	}

	_prolinkId(value, min = 0, max = 2147483647) {
		if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return null
		const id = Number(value)
		return Number.isInteger(id) && id >= min && id <= max ? id : null
	}

	_controlFailure(message) {
		this.state.failedStepsTotal++
		this._log('warn', message)
		this.setVariableValues({ control_last_error: message })
		this._updateVariables()
		return false
	}

	_sendProlink(command, id) {
		if (this._destroyed || this._transport() !== 'prolink' || !this._prolinkReady)
			return this._controlFailure('ProLink is not ready; command was not queued')
		try {
			const sequence = this._prolink.send(command, id)
			this._prolinkObservations.track(command, sequence, id)
			// Legacy Generic-MIDI triggers watch last_action_timestamp. Keep that pulse MIDI-only.
			this.setVariableValues({ control_last_error: '', prolink_last_send_timestamp: Date.now() })
			this._updateVariables()
			return true
		} catch (error) {
			return this._controlFailure(error.message)
		}
	}

	async routeProlinkSnapshot(command, value) {
		const gate =
			command === 'RecallSnapshot'
				? 'prolinkRecallEnabled'
				: command === 'HighlightSnapshot'
					? 'prolinkHighlightEnabled'
					: null
		if (!gate || this.config?.[gate] !== true) return this._controlFailure('This ProLink snapshot action is disabled')
		const id = this._prolinkId(value)
		if (id === null) return this._controlFailure('Snapshot provider ID must be an integer from 0 to 2147483647')
		return this._sendProlink(command, id)
	}

	async _configureTransport() {
		if (this._destroyed) return
		const transport = this._transport()
		const options = {
			interfaceName: this.config?.prolinkInterface || '',
			name: this.config?.prolinkName ?? 'Mixing Station',
		}
		const snapshot = JSON.stringify([transport, transport === 'midi' ? midiConfigSnapshot(this.config) : options])
		if (snapshot === this._transportConfig && this._prolink.state !== 'fault' && !this._transportSwitching) return
		const revision = ++this._transportRevision
		this._transportSwitching = true
		this._prolinkReady = false
		const operation = this._transportOperations.then(async () => {
			if (this._destroyed || revision !== this._transportRevision) return
			try {
				// Break before make: no new service until both old services have stopped.
				await this._prolink.stop()
				await stopMidiService(this)
				if (this._destroyed || revision !== this._transportRevision) return
				if (transport === 'prolink') {
					await this._prolink.start(options)
				} else if (transport === 'midi') {
					await startMidiService(this)
				} else {
					this._transportConfig = null
					this._log('error', 'Control transport switch failed: Unknown control transport')

					if (!this._destroyed) {
						this.updateStatus(
							InstanceStatus.ConnectionFailure,
							'Unknown control transport',
						)
					}
					return
				}
				if (this._destroyed || revision !== this._transportRevision) return
				this._transportConfig = snapshot
				this._prolinkReady = transport === 'prolink'
				this._transportSwitching = false
				if (transport === 'midi') this.updateStatus(InstanceStatus.Ok)
			} catch (error) {
				this._transportConfig = null
				this._log('error', `Control transport switch failed: ${error.message}`)
				if (!this._destroyed) this.updateStatus(InstanceStatus.ConnectionFailure, error.message)
				// Remain blocked: a failed stop must never allow fallback to the other transport.
			}
		})
		this._transportOperations = operation.catch(() => {})
		await operation
	}

	_prolinkStateChanged(state, error) {
		if (this._destroyed) return
		if (state !== 'connected') {
			this._prolinkObservations?.reset()
			// Force a fresh initial debug snapshot after reconnect.
			this._lastRackConfig = null
			this._lastTouchOwnership = undefined
		}
		this.setVariableValues({ prolink_state: state, prolink_error: error || '' })
		this.checkFeedbacks?.('prolink_connected')
		if (this._transport() !== 'prolink') return
		const statuses = {
			starting: InstanceStatus.Connecting,
			waiting: InstanceStatus.Connecting,
			connected: InstanceStatus.Ok,
			fault: InstanceStatus.ConnectionFailure,
			stopped: InstanceStatus.Disconnected,
		}
		this.updateStatus(
			statuses[state],
			error ||
				(state === 'waiting'
					? 'Waiting for ProLink assignment in SuperRack'
					: state === 'connected'
						? 'ProLink TCP connected; remote execution is not acknowledged'
						: `ProLink ${state}`),
		)
		if (error) this._log('error', error)
	}
}

try {
	runEntrypoint(ModuleInstance, UpgradeScripts)
} catch (e) {
	console.error('[BOOT][FATAL] runEntrypoint error', e)
}

module.exports = ModuleInstance
