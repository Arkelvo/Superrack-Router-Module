'use strict'
const { ProLinkObservations } = require('../lib/prolink-observations')

const prefix = '/waves.com/remote/'
function oscString(s) {
	const value = Buffer.from(s, 'utf8')
	const result = Buffer.alloc(Math.ceil((value.length + 1) / 4) * 4)
	value.copy(result)
	return result
}
function int32(n) {
	const result = Buffer.alloc(4)
	result.writeInt32BE(n)
	return result
}
function frame(command, tags, args = []) {
	return { type: 5, payload: Buffer.concat([oscString(prefix + command), oscString(tags), ...args]) }
}
function make() {
	const values = {}
	const instance = {
		_log: jest.fn(), checkFeedbacks: jest.fn(), updateActions: jest.fn(),
		setVariableValues: jest.fn(next => Object.assign(values, next)),
	}
	return { observations: new ProLinkObservations(instance), values, instance }
}

test('getter replies complete a request without a successful ResultCommand', () => {
	const { observations: obs, values } = make()
	obs.track('GetNumRacks', 4)
	obs.receive(frame('GiveNumRacks', ',ii', [int32(4), int32(64)]))
	expect(values.prolink_command_pending).toBe(0)
	expect(values.prolink_last_command_status).toBe('replied')
	expect(values.prolink_last_reply_request).toBe('GetNumRacks')
	expect(values.prolink_last_reply_matched).toBe(true)
	expect(values.prolink_last_reply_args).toBe('[64]')
	obs.receive(frame('GiveNumRacks', ',ii', [int32(4), int32(64)])) // duplicate should remain matched
	expect(values.prolink_last_reply_matched).toBe(true)
	obs.reset()
})

test('getter reply after successful ResultCommand is correlated, not discarded', () => {
	const { observations: obs, values } = make()
	obs.track('GetRackName', 12)
	obs.receive(frame('ResultCommand', ',iis', [
		int32(12), int32(0), oscString(prefix + 'GetRackName succeeded'),
	]))
	expect(values.prolink_command_pending).toBe(1)
	obs.receive(frame('GiveRackName', ',is', [int32(12), oscString('Vocals')]))
	expect(values.prolink_last_reply_matched).toBe(true)
	expect(values.prolink_last_reply_request).toBe('GetRackName')
	expect(values.prolink_command_pending).toBe(0)
	obs.reset()
})

test('the singular GiveListOfSnapshot name is essential for correlation', () => {
	const { observations: obs, values } = make()
	obs.track('GetListOfSnapshots', 91)
	obs.receive(frame('GiveListOfSnapshots', ',i', [int32(91)]))
	expect(values.prolink_last_reply_matched).toBe(false)
	expect(values.prolink_command_pending).toBe(1)
	// Valid empty snapshot list: request ID followed by item count 0.
	obs.receive(frame('GiveListOfSnapshot', ',ii', [int32(91), int32(0)]))
	expect(values.prolink_last_reply_matched).toBe(true)
	expect(values.prolink_command_pending).toBe(0)
	obs.reset()
})

test('ResultCommand remains a separate success state for mutators', () => {
	const { observations: obs, values } = make()
	obs.track('ShowRackByID', 33)
	obs.receive(frame('ResultCommand', ',iis', [
		int32(33), int32(0), oscString(prefix + 'ShowRackByID succeeded'),
	]))
	expect(values.prolink_last_command_status).toBe('succeeded')
	expect(values.prolink_command_pending).toBe(0)
	obs.reset()
})

test('disconnect resets outstanding queries and receiver status', () => {
	const { observations: obs, values } = make()
	obs.track('GetCPUUsage', 2)
	obs.reset()
	expect(values.prolink_command_pending).toBe(0)
	expect(values.prolink_last_reply_request).toBe('')
	expect(obs.pending.size).toBe(0)
})
