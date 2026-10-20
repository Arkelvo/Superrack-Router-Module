'use strict'

// Snapshot mutations use a *freshly correlated* GetCurrentSnapshotNumber reply.
// No mutation may use a previously stored currentNumber/Companion variable as its target.
// The validated snapshot list is still required to resolve provider IDs and positions.
const SNAPSHOT_WRITE_COMMANDS = new Set([
	'StoreSnapshot', 'DuplicateSnapshot', 'MoveSnapshot', 'SetSnapshotName', 'DeleteSnapshot',
])

const confirmOption = {
	id: 'confirm', type: 'dropdown', label: 'Explicit authorization',
	choices: [{ id: 'no', label: 'No – do not modify snapshots' }, { id: 'yes', label: 'YES – modify SuperRack snapshots' }],
	default: 'no',
}

function createProLinkSnapshotActions(self) {
	const list = self._prolinkObservations?.snapshots
	const entries = list?.listKnown ? list.listEntries : []
	const positionChoices = entries.map((entry, position) => ({
		id: String(position), label: `${position}: ${entry.name || '(unnamed)'} [ID ${entry.id}]`,
	}))

	function reject(message) { return self._controlFailure(`ProLink snapshot edit: ${message}`) }
	function liveList() {
		const obs = self._prolinkObservations
		if (self.config?.controlTransport !== 'prolink' ||
			!obs?.snapshots?.listKnown || !Array.isArray(obs.snapshots.listEntries) ||
			obs.snapshotSyncStatus !== 'ready' || self._prolink?.state !== 'connected' ||
			self._transportSwitching || self._destroyed) return null
		return obs.snapshots.listEntries
	}
	function contiguousPositions(current) {
		return current.every((entry, position) => entry.id === position)
	}
	function currentPosition(current, currentId) {
		if (!contiguousPositions(current)) return { ok: false, message: 'snapshot IDs do not match positions; positional edit blocked' }
		const position = current.findIndex(entry => entry.id === currentId)
		return position < 0 ? { ok: false, message: 'fresh current snapshot is absent from the list' } : { ok: true, position }
	}

	async function sendUsingFreshCurrent(command, confirmation, validate) {
		if (!SNAPSHOT_WRITE_COMMANDS.has(command)) return reject('unsupported snapshot edit')
		if (confirmation !== 'yes') return reject('explicit authorization is required')
		const obs = self._prolinkObservations
		if (obs?.snapshotMutationInProgress) return reject('another snapshot edit is in progress')
		const originalList = liveList()
		if (!originalList) return reject('a complete snapshot list and an established ProLink connection are required')
		if (typeof obs.requestFreshCurrentSnapshot !== 'function') return reject('fresh snapshot lookup is unavailable')
		const token = {}
		obs.snapshotMutationInProgress = token
		try {
			let currentId
			try {
				currentId = await obs.requestFreshCurrentSnapshot()
			} catch (error) {
				return reject(`fresh GetCurrentSnapshotNumber failed: ${error.message}`)
			}
			// A list refresh, transport change or edit while awaiting the answer
			// invalidates the choice. Never silently fall back to cached state.
			const current = liveList()
			if (obs.snapshotMutationInProgress !== token) return reject('snapshot edit cancelled by connection reset')
			if (!current || current !== originalList) return reject('snapshot list or connection changed during current-snapshot lookup')
			if (!Number.isInteger(currentId) || !current.some(entry => entry.id === currentId)) {
				return reject('fresh current snapshot ID is not in the validated list')
			}
			const result = validate(current, currentId)
			if (!result.ok) return reject(result.message)
			if (!self._sendProlink(command, result.argument)) return false
			obs.snapshotSyncStatus = 'refresh_required'
			self.setVariableValues?.({
				prolink_snapshot_sync_status: 'refresh_required',
				prolink_snapshot_last_edit_command: command,
				prolink_snapshot_last_edit_status: 'pending',
			})
			return true
		} finally {
			if (obs.snapshotMutationInProgress === token) obs.snapshotMutationInProgress = null
		}
	}

	return {
		prolink_store_snapshot: {
			name: 'ProLink: Store current snapshot (fresh lookup, experimental)',
			options: [confirmOption],
			callback: async ({ options }) => sendUsingFreshCurrent('StoreSnapshot', options.confirm, () => ({ ok: true, argument: undefined })),
		},
		prolink_duplicate_snapshot: {
			name: 'ProLink: Duplicate current snapshot (fresh lookup, experimental)',
			options: [confirmOption],
			callback: async ({ options }) => sendUsingFreshCurrent('DuplicateSnapshot', options.confirm, (current, currentId) => {
				if (current.length >= 512) return { ok: false, message: 'snapshot list has reached the supported maximum' }
				const source = currentPosition(current, currentId)
				return source.ok ? { ok: true, argument: source.position } : source
			}),
		},
		prolink_move_snapshot: {
			name: 'ProLink: Move current snapshot to list position (fresh lookup, experimental)',
			options: [
				{ id: 'destination', type: 'dropdown', label: 'Destination list position', choices: positionChoices, default: positionChoices[0]?.id },
				confirmOption,
			],
			callback: async ({ options }) => sendUsingFreshCurrent('MoveSnapshot', options.confirm, (current, currentId) => {
				const source = currentPosition(current, currentId)
				if (!source.ok) return source
				const target = self._prolinkId(options.destination, 0, current.length - 1)
				if (target === null) return { ok: false, message: 'destination position is not in the current list' }
				if (source.position === target) return { ok: false, message: 'source and destination must differ' }
				return { ok: true, argument: [source.position, target] }
			}),
		},
		prolink_rename_snapshot: {
			name: 'ProLink: Rename current snapshot (fresh lookup, experimental)',
			options: [
				{ id: 'name', type: 'textinput', label: 'New snapshot name (UTF-8)', default: '', required: true },
				confirmOption,
			],
			callback: async ({ options }) => sendUsingFreshCurrent('SetSnapshotName', options.confirm, (_current, currentId) => {
				const name = options.name
				if (typeof name !== 'string' || !name.trim() || name.includes('\0') || Buffer.byteLength(name, 'utf8') > 2048) {
					return { ok: false, message: 'invalid new snapshot name' }
				}
				return { ok: true, argument: [{ id: currentId, name }] }
			}),
		},
		prolink_delete_snapshot: {
			name: 'ProLink: DELETE CURRENT snapshot (fresh lookup, destructive, experimental)',
			options: [
				confirmOption,
				{ id: 'deleteConfirmation', type: 'textinput', label: 'Type DELETE CURRENT to confirm deleting the ACTIVE snapshot', default: '' },
			],
			callback: async ({ options }) => {
				// Check extra confirmation before sending the read request.
				if (options.confirm !== 'yes' || options.deleteConfirmation !== 'DELETE CURRENT') {
					return reject('deleting the active snapshot requires YES and exact DELETE CURRENT confirmation')
				}
				return sendUsingFreshCurrent('DeleteSnapshot', options.confirm, (current, currentId) => {
					if (current.length < 2) return { ok: false, message: 'cannot delete the last known snapshot' }
					return { ok: true, argument: [currentId] }
				})
			},
		},
	}
}

module.exports = { createProLinkSnapshotActions, SNAPSHOT_WRITE_COMMANDS }
