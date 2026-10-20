'use strict'

// Getter response names are taken from the REA ProLink sender literals.
// Note the two non-obvious singular forms.
const GETTER_REPLIES = Object.freeze({
	GetNumRacks: 'GiveNumRacks',
	GetRackName: 'GiveRackName',
	GetRacksInfo: 'GiveRackInfo',
	GetCurrentSnapshotNumber: 'GiveCurrentSnapshotNumber',
	GetSnapshotName: 'GiveSnapshotName',
	GetListOfSnapshots: 'GiveListOfSnapshot',
	GetCPUUsage: 'GiveCPUUsage',
	GetSessionDirtyState: 'GiveSessionDirtyState',
})

class ProLinkRequestTracker {
	constructor({ onTimeout = () => {}, timeoutMs = 2500 } = {}) {
		this.onTimeout = onTimeout
		this.timeoutMs = timeoutMs
		this.pending = new Map()
	}

	get size() { return this.pending.size }

	track(command, sequence, argument) {
		if (!Number.isInteger(sequence)) return false
		this.clear(sequence)
		const item = {
			sequence, command, argument,
			expectedReply: GETTER_REPLIES[command] || null,
			result: null,
			timer: null,
		}
		item.timer = setTimeout(() => {
			if (this.pending.get(sequence) !== item) return
			this.pending.delete(sequence)
			this.onTimeout(item)
		}, this.timeoutMs)
		item.timer.unref?.()
		this.pending.set(sequence, item)
		return true
	}

	clear(sequence) {
		const item = this.pending.get(sequence)
		if (!item) return null
		clearTimeout(item.timer)
		this.pending.delete(sequence)
		return item
	}

	reset() {
		for (const item of this.pending.values()) clearTimeout(item.timer)
		this.pending.clear()
	}

	// A Give* payload's first argument is a request ID, not a provider ID.
	// Preserve the request argument so rack/snapshot objects can be identified.
	receiveReply(replyName, sequence) {
		const item = this.pending.get(sequence)
		if (!item || item.expectedReply !== replyName) return null
		this.clear(sequence)
		return item
	}

	// Successful getters return Give*, not necessarily ResultCommand.
	// An early ResultCommand for a getter is recorded without losing the
	// context required to correlate the eventual Give* response.
	receiveResult(sequence, code, text) {
		const item = this.pending.get(sequence)
		if (!item) return null
		if (item.result) return { item, duplicate: true, complete: false }
		item.result = { code, text }
		const success = code === 0 && text === `/waves.com/remote/${item.command} succeeded`
		const complete = !item.expectedReply || !success
		if (complete) this.clear(sequence)
		return { item, duplicate: false, complete, success }
	}
}

module.exports = { ProLinkRequestTracker, GETTER_REPLIES }
