'use strict'
const { ProLinkRequestTracker, GETTER_REPLIES } = require('../lib/prolink-request-tracker')

describe('ProLink request/reply correlation', () => {
	test('uses the verified singular OSC reply names', () => {
		expect(GETTER_REPLIES.GetListOfSnapshots).toBe('GiveListOfSnapshot')
		expect(GETTER_REPLIES.GetRacksInfo).toBe('GiveRackInfo')
	})
	test('correlates overlapping getter replies out of order by request ID', () => {
		const t = new ProLinkRequestTracker()
		t.track('GetRackName', 11, 7)
		t.track('GetSnapshotName', 12, 42)
		expect(t.receiveReply('GiveSnapshotName', 11)).toBeNull()
		expect(t.receiveReply('GiveSnapshotName', 12).argument).toBe(42)
		expect(t.receiveReply('GiveRackName', 11).argument).toBe(7)
		expect(t.size).toBe(0)
	})
	test('early ResultCommand on getter does not drop the Give* correlation', () => {
		const t = new ProLinkRequestTracker()
		t.track('GetRackName', 55, 3)
		const r = t.receiveResult(55, 0, '/waves.com/remote/GetRackName succeeded')
		expect(r.complete).toBe(false)
		expect(t.receiveReply('GiveRackName', 55).argument).toBe(3)
	})
	test('mutators complete on ResultCommand and do not yield query states', () => {
		const t = new ProLinkRequestTracker()
		t.track('ShowRackByID', 24, 2)
		expect(t.receiveResult(24, 0, '/waves.com/remote/ShowRackByID succeeded').complete).toBe(true)
		expect(t.receiveReply('GiveRackName', 24)).toBeNull()
	})
	test('a failed getter ResultCommand finishes rather than trusting a later reply', () => {
		const t = new ProLinkRequestTracker()
		t.track('GetRackName', 9, 1)
		expect(t.receiveResult(9, 37, 'rejected').complete).toBe(true)
		expect(t.receiveReply('GiveRackName', 9)).toBeNull()
	})
	test('duplicate/unknown replies cannot consume a different request', () => {
		const t = new ProLinkRequestTracker()
		t.track('GetNumRacks', 10)
		expect(t.receiveReply('GiveNumRacks', 99)).toBeNull()
		expect(t.receiveReply('GiveRackName', 10)).toBeNull()
		expect(t.receiveReply('GiveNumRacks', 10).command).toBe('GetNumRacks')
		expect(t.receiveReply('GiveNumRacks', 10)).toBeNull()
	})
	test('timeout and reset clear outstanding timers without false success', () => {
		jest.useFakeTimers()
		try {
			const timedOut = []
			const t = new ProLinkRequestTracker({ timeoutMs: 100, onTimeout: x => timedOut.push(x) })
			t.track('GetRackName', 1, 2)
			jest.advanceTimersByTime(100)
			expect(timedOut[0].command).toBe('GetRackName')
			expect(t.size).toBe(0)
			t.track('GetRackName', 2, 3)
			t.reset()
			jest.advanceTimersByTime(100)
			expect(timedOut).toHaveLength(1)
		} finally { jest.useRealTimers() }
	})
})
