import { describe, it, expect } from 'vitest'
import { HealthTracker } from '../health.js'
import { CostEstimator } from '../cost.js'
import { priorityStrategy, lowestCostStrategy, highestSuccessStrategy } from '../strategies.js'
import type { AdapterEntry, RouteRequest } from '../types.js'

// Mock adapter
function mockAdapter(type: string) {
  return {
    type,
    detect: () => false,
    verify: async () => ({ valid: false, error: 'mock' }),
    describeMethod: () => ({ type } as any),
    supports: (m: any) => m.type === type,
    pay: async () => ({ header: '', value: '' }),
  }
}

function mockEntry(type: string, opts: Partial<AdapterEntry> = {}): AdapterEntry {
  return { adapter: mockAdapter(type), ...opts }
}

const req: RouteRequest = { amount: '10.00', currency: 'USD' }

describe('HealthTracker', () => {
  it('returns default health for unknown adapter', () => {
    const tracker = new HealthTracker()
    const health = tracker.getHealth('unknown')
    expect(health.successRate).toBe(1.0) // optimistic default
    expect(health.totalAttempts).toBe(0)
  })

  it('tracks success rate', () => {
    const tracker = new HealthTracker()
    tracker.recordSuccess('mpp', 50)
    tracker.recordSuccess('mpp', 60)
    tracker.recordFailure('mpp', 'err')
    const health = tracker.getHealth('mpp')
    expect(health.totalAttempts).toBe(3)
    expect(health.successRate).toBeCloseTo(0.667, 2)
  })

  it('tracks average latency', () => {
    const tracker = new HealthTracker()
    tracker.recordSuccess('mpp', 100)
    tracker.recordSuccess('mpp', 200)
    const health = tracker.getHealth('mpp')
    expect(health.avgLatencyMs).toBe(150)
  })

  it('isHealthy with configurable threshold', () => {
    const tracker = new HealthTracker()
    tracker.recordSuccess('mpp', 50)
    expect(tracker.isHealthy('mpp', 0.5)).toBe(true)
    tracker.recordFailure('mpp')
    tracker.recordFailure('mpp')
    expect(tracker.isHealthy('mpp', 0.5)).toBe(false)
  })
})

describe('CostEstimator', () => {
  it('estimates flat cost', () => {
    const estimator = new CostEstimator()
    const entry = mockEntry('stripe', { costPerTransaction: '0.30' })
    const result = estimator.estimateCost(entry, '10.00', 'USD')
    expect(result.isViable).toBe(true)
    expect(parseFloat(result.transactionCost)).toBeCloseTo(0.30)
  })

  it('estimates percentage cost', () => {
    const estimator = new CostEstimator()
    const entry = mockEntry('stripe', { costPerTransaction: '0.30', costPercentage: 2.9 })
    const result = estimator.estimateCost(entry, '10.00', 'USD')
    expect(result.isViable).toBe(true)
    expect(parseFloat(result.transactionCost)).toBeCloseTo(0.59) // 0.30 + 0.29
  })

  it('marks as not viable below minimum', () => {
    const estimator = new CostEstimator()
    const entry = mockEntry('stripe', { minimumAmount: '5.00' })
    const result = estimator.estimateCost(entry, '1.00', 'USD')
    expect(result.isViable).toBe(false)
  })

  it('marks as not viable for unsupported currency', () => {
    const estimator = new CostEstimator()
    const entry = mockEntry('stripe', { currencies: ['USD'] })
    const result = estimator.estimateCost(entry, '10.00', 'EUR')
    expect(result.isViable).toBe(false)
  })

  it('ranks by cost', () => {
    const estimator = new CostEstimator()
    const entries = [
      mockEntry('stripe', { costPerTransaction: '0.30' }),
      mockEntry('mpp', { costPerTransaction: '0.001' }),
      mockEntry('x402', { costPerTransaction: '0.001' }),
    ]
    const ranked = estimator.rankByCost(entries, '10.00', 'USD')
    expect(ranked[0].adapterType).toBe('mpp')
  })
})

describe('Routing Strategies', () => {
  const health = new HealthTracker()
  const cost = new CostEstimator()

  it('priority strategy sorts by priority', () => {
    const entries = [
      mockEntry('stripe', { priority: 2 }),
      mockEntry('mpp', { priority: 0 }),
      mockEntry('x402', { priority: 1 }),
    ]
    const result = priorityStrategy(entries, req, health, cost)
    expect(result.map(a => a.type)).toEqual(['mpp', 'x402', 'stripe'])
  })

  it('lowest-cost strategy returns cheapest first', () => {
    const entries = [
      mockEntry('stripe', { costPerTransaction: '0.30', costPercentage: 2.9 }),
      mockEntry('mpp', { costPerTransaction: '0.001' }),
    ]
    const result = lowestCostStrategy(entries, req, health, cost)
    expect(result[0].type).toBe('mpp')
  })

  it('highest-success strategy excludes unhealthy adapters', () => {
    const h = new HealthTracker()
    h.recordSuccess('mpp', 50)
    h.recordSuccess('mpp', 50)
    h.recordFailure('stripe')
    h.recordFailure('stripe')
    h.recordFailure('stripe')

    const entries = [mockEntry('mpp'), mockEntry('stripe')]
    const result = highestSuccessStrategy(entries, req, h, cost, 0.5)
    expect(result.map(a => a.type)).toEqual(['mpp'])
  })
})
