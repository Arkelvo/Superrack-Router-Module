const fastifyFactory = require('fastify')
const fastifyStatic = require('@fastify/static')
const { getPatchUiState } = require('../lib/patch-ui-state')

const _startHttpServer = async function (instance) {
	if (instance._http.restarting) {
		instance._log('debug', 'HTTP server restart in progress')
		return
	}
	if (instance._http.started) {
		instance._log('debug', 'HTTP server already running')
		return
	}
	const fastify = fastifyFactory({ logger: false })

	// Static for Patch-UI (Fastify v5 + @fastify/static v8)
	fastify.register(fastifyStatic, {
		root: [require('path').join(__dirname, 'public'), __dirname],
		prefix: '/patch/',
	})

	// Temporary redirect, independent of transport. Avoid redirecting API/assets.
	fastify.get('/', async (_req, reply) => reply.redirect('/patch', 307))
	fastify.get('/test', async (_req, reply) => reply.sendFile('./public/home.html'))
	fastify.get('/patch', async (_req, reply) => reply.sendFile('./public/rack-channel.html'))
	fastify.get('/patch/', async (_req, reply) => reply.sendFile('./public/rack-channel.html'))

	fastify.get('/health', async () => ({
		status: 'ok',
		sequenceRunning: !!instance.state?.sequenceRunning,
		activeSourceIndex: instance.state?.activeSourceIndex ?? null,
	}))

	// Only current, observed names are projected to the UI. No request sends or config changes.
	fastify.get('/patch/state', async (_req, reply) => {
		reply.header('Cache-Control', 'no-store')
		return getPatchUiState(instance)
	})

	// Get current mappings from config
	fastify.get('/patch/mappings', async (_req, reply) => {
		const maxRacks = parseInt(instance.config?.maxRacks, 10) || instance.rackCount || 64
		reply.code(200)
		return {
			success: true,
			meta: { numY: maxRacks, numX: instance.channelCount, emptyMapping: instance.emptyMapping },
			mapping: instance.config.racks,
		}
	})

	// Apply mappings (connect)
	fastify.post('/patch/update', async (req, reply) => {
		try {
			const body = req.body || {}
			const mapping = body.mapping || []
			instance._log('info', 'PATCH_UPDATE received mapping', {
				length: Array.isArray(mapping) ? mapping.length : 0,
				sample: Array.isArray(mapping) ? mapping.slice(1, 5) : null,
			})
			const isChanged = JSON.stringify(instance.config.racks) !== JSON.stringify(mapping)
			if (isChanged) {
				instance.config.racks = mapping
				instance.rackMap = mapping
				instance._log('info', 'PATCH_UPDATE applied mapping', {
					rackMapType: typeof instance.rackMap,
					rackMapSample: Array.isArray(instance.rackMap) ? instance.rackMap.slice(1, 5) : null,
				})
				instance.saveConfig(instance.config)
				instance._log('info', 'PATCH_UPDATE saved config', { racksLength: instance.config?.racks?.length })
				instance._applyConfigToLocalScopes()
				instance.updateActions()
				instance.updateFeedbacks()
				instance.updateVariableDefinitions()
			}
			reply.code(200)
			return { status: 200, result: { updated: isChanged ? mapping.length - 1 : 0, total: mapping.length - 1 } }
		} catch (e) {
			instance._log('error', 'HTTP update failed', { error: e?.message })
			reply.code(500)
			return { status: 500, error: e?.message }
		}
	})

	fastify.patch('/rack/:id', async (req, reply) => {
		try {
			const { id } = req.params || {}
			const body = req.body || {}
			const rackId = parseInt(id, 10)
			if (isNaN(rackId)) {
				reply.code(400)
				return { status: 400, error: 'invalid rack id' }
			}

			const rackConfig = instance.config.racks?.[rackId] || { id: rackId, value: null }
			const newValue = body.value
			if (newValue == null || isNaN(parseInt(newValue, 10))) {
				reply.code(400)
				return { status: 400, error: 'invalid channel value' }
			}

			rackConfig.value = parseInt(newValue, 10)
			instance.config.racks[rackId] = rackConfig
			instance.saveConfig(instance.config)
			instance._applyConfigToLocalScopes()
			instance.updateActions()
			instance.updateFeedbacks()
			instance.updateVariableDefinitions()
			reply.code(200)
			return { status: 200, message: 'success' }
		} catch (e) {
			instance._log('error', 'HTTP rack patch failed', { error: e?.message })
			reply.code(500)
			return { status: 500, error: e?.message }
		}
	})

	// Keep the MIDI mapping data persisted, but hide MIDI-only editors in ProLink mode.
	const midiEditorUnavailable = (_req, reply) => {
		if (instance.config?.controlTransport !== 'prolink') return false
		reply.code(404).send({ status: 404, error: 'MIDI patch editor is unavailable in ProLink mode' })
		return true
	}

	fastify.get('/midi/plugin', async (req, reply) => {
		if (midiEditorUnavailable(req, reply)) return reply
		return reply.sendFile('./public/midi-plugin.html')
	})
	fastify.get('/midi/snapshot', async (req, reply) => {
		if (midiEditorUnavailable(req, reply)) return reply
		return reply.sendFile('./public/midi-snapshot.html')
	})

	fastify.get('/midi/plugin/mapping', async (_req, reply) => {
		reply.code(200)
		return {
			success: true,
			meta: { numX: 128, numY: 12, emptyMapping: instance.hotPlugin.emptyMapping },
			mapping: instance.hotPlugin.mapping,
			type: instance.hotPlugin.type,
			channel: instance.hotPlugin.channel,
		}
	})
	fastify.post('/midi/plugin/update', async (req, reply) => {
		try {
			const mapping = req.body?.mapping
			const eventType = req.body?.eventType
			const midiChannel = req.body?.channel
			if (!mapping && !eventType && !midiChannel) {
				reply.code(400)
				return { status: 400, error: 'No mapping, eventType or channel provided' }
			}

			let isChanged = true
			if (mapping) {
				isChanged = JSON.stringify(instance.config.hotPlugin?.mapping) !== JSON.stringify(mapping)
				if (isChanged) instance.hotPlugin.mapping = mapping
			}
			if (eventType) instance.hotPlugin.type = eventType
			if (midiChannel) {
				if (parseInt(midiChannel) === parseInt(instance.hotSnapshot.channel)) {
					reply.code(400)
					return { status: 400, error: 'MIDI Channel darf nicht gleichzeitig für Plugin und Snapshot verwendet werden.' }
				}
				instance.hotPlugin.channel = midiChannel
			}
			if (isChanged) {
				instance.config.hotPlugin = instance.hotPlugin
				instance.saveConfig(instance.config)
				instance._applyConfigToLocalScopes()
				instance.updateActions()
				instance.updateFeedbacks()
				instance.updateVariableDefinitions()
			}
			reply.code(200)
			return { status: 200, result: { updated: true } }
		} catch (e) {
			reply.code(500)
			return { status: 500, error: e?.message }
		}
	})

	fastify.get('/midi/snapshot/mapping', async (_req, reply) => {
		reply.code(200)
		return {
			success: true,
			meta: { numX: 128, numY: 6, emptyMapping: instance.hotSnapshot.emptyMapping },
			mapping: instance.hotSnapshot.mapping,
			type: instance.hotSnapshot.type,
			channel: instance.hotSnapshot.channel,
		}
	})
	fastify.post('/midi/snapshot/update', async (req, reply) => {
		try {
			const mapping = req.body?.mapping
			const eventType = req.body?.eventType
			const midiChannel = req.body?.channel
			if (!mapping && !eventType && !midiChannel) {
				reply.code(400)
				return { status: 400, error: 'No mapping, eventType or channel provided' }
			}

			let isChanged = true
			if (mapping) {
				isChanged = JSON.stringify(instance.config.hotSnapshot?.mapping) !== JSON.stringify(mapping)
				if (isChanged) instance.hotSnapshot.mapping = mapping
			}
			if (eventType) instance.hotSnapshot.type = eventType
			if (midiChannel) {
				if (parseInt(midiChannel) === parseInt(instance.hotPlugin.channel)) {
					reply.code(400)
					return { status: 400, error: 'MIDI Channel darf nicht gleichzeitig für Plugin und Snapshot verwendet werden.' }
				}
				instance.hotSnapshot.channel = midiChannel
			}
			if (isChanged) {
				instance.config.hotSnapshot = instance.hotSnapshot
				instance.saveConfig(instance.config)
				instance._applyConfigToLocalScopes()
				instance.updateActions()
				instance.updateFeedbacks()
				instance.updateVariableDefinitions()
			}
			reply.code(200)
			return { status: 200, result: { updated: true } }
		} catch (e) {
			reply.code(500)
			return { status: 500, error: e?.message }
		}
	})

	const host = '0.0.0.0'
	try {
		await fastify.listen({ port: instance._http.port, host })
		instance._http.server = fastify
		instance._http.started = true
		instance._log('info', `HTTP server started, listening on ${host}:${instance._http.port}`)
	} catch (err) {
		instance._log('error', `Failed to start HTTP server on ${host}:${instance._http.port}: ${err.message}`)
		instance.updateStatus && instance.updateStatus('error')
	}
}

const _stopHttpServer = async function (instance) {
	if (instance._http.restarting) return
	instance._http.restarting = true
	if (instance._http.server && instance._http.started) {
		try {
			await instance._http.server.close()
			instance._log('info', 'HTTP server stopped')
		} catch (err) {
			instance._log('error', 'Failed to stop HTTP server: ' + err.message)
		}
	}
	instance._http.server = null
	instance._http.started = false
	instance._http.restarting = false
}

module.exports = { startHttpServer: _startHttpServer, stopHttpServer: _stopHttpServer }
