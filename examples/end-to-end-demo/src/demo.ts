// @ts-nocheck
/**
 * OpenAgentPay — End-to-End Demo
 *
 * A single runnable script that demonstrates the entire agent payment flow:
 *   1. Start a paid API server
 *   2. Agent requests without payment (gets 402)
 *   3. Agent pays per-call with a mock wallet
 *   4. Agent subscribes to a daily plan
 *   5. Agent uses the subscription (no per-call payment)
 *   6. Agent unsubscribes
 *   7. Summary
 *
 * Run: pnpm start
 */

import express from 'express'
import { createPaywall } from '@openagentpay/server-express'
import { mock, mockWallet } from '@openagentpay/adapter-mock'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LINE = '\u2501'.repeat(63)

function header(title: string): void {
  console.log(`\n${LINE}`)
  console.log(`  ${title}`)
  console.log(LINE)
}

function step(n: number, label: string): void {
  console.log(`\nStep ${n}: ${label}`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  header('OpenAgentPay \u2014 End-to-End Demo')

  // =========================================================================
  // Step 1 — Start an Express server with paywall
  // =========================================================================
  step(1, 'Starting paid API server...')

  const app = express()
  app.use(express.json())

  const paywall = createPaywall({
    recipient: '0xDemoRecipient',
    adapters: [mock({ logging: false })],
    receipts: { store: 'memory', emit: true },
    subscriptions: {
      store: 'memory',
      plans: [
        {
          id: 'daily-unlimited',
          amount: '0.50',
          currency: 'USDC',
          period: 'day',
          calls: 'unlimited',
        },
      ],
    },
  })

  // Paid endpoint
  app.get(
    '/api/data',
    paywall({ price: '0.01', currency: 'USDC', description: 'Premium data endpoint' }),
    (_req, res) => {
      res.json({ message: 'Premium data', value: 42 })
    },
  )

  // Subscription management routes
  app.use(paywall.routes())

  // Start on a random available port
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })

  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  const baseUrl = `http://localhost:${port}`

  console.log(`  Server running on ${baseUrl}`)

  // Track stats
  let totalCalls = 0
  let paidPerCall = 0
  let paidSubscription = 0
  let freeResponses = 0

  try {
    // =========================================================================
    // Step 2 — Agent requests without payment → 402
    // =========================================================================
    step(2, 'Agent requests without payment...')

    const res402 = await fetch(`${baseUrl}/api/data`)
    totalCalls++
    freeResponses++

    const body402 = await res402.json()
    console.log(`  GET /api/data \u2192 ${res402.status} Payment Required`)
    console.log(`  Price: $${body402.pricing?.amount ?? '0.01'} ${body402.pricing?.currency ?? 'USDC'} ${body402.pricing?.unit ?? 'per_request'}`)

    const methodTypes = (body402.methods ?? []).map((m: any) => m.type).join(', ')
    console.log(`  Methods: ${methodTypes || 'mock'}`)

    if (body402.subscriptions?.length) {
      const plan = body402.subscriptions[0]
      console.log(`  Subscriptions: ${plan.id} ($${plan.amount}/${plan.period})`)
    }

    // =========================================================================
    // Step 3 — Agent pays per-call with mock wallet
    // =========================================================================
    step(3, 'Agent pays per-call (mock)...')

    const wallet = mockWallet({ initialBalance: '10.00' })

    // Generate a mock payment proof
    const pricing = { amount: '0.01', currency: 'USDC', unit: 'per_request' as const }
    const mockMethod = { type: 'mock', description: 'Mock payment' }
    const proof = await wallet.pay(mockMethod as any, pricing)

    const resPaid = await fetch(`${baseUrl}/api/data`, {
      headers: { [proof.header]: proof.value },
    })
    totalCalls++
    paidPerCall++

    const bodyPaid = await resPaid.json()
    console.log(`  GET /api/data (with X-PAYMENT: ${proof.value.slice(0, 20)}...)`)
    console.log(`  \u2192 ${resPaid.status} OK`)
    console.log(`  \u2192 ${JSON.stringify(bodyPaid)}`)

    // =========================================================================
    // Step 4 — Agent subscribes to daily plan
    // =========================================================================
    step(4, 'Agent subscribes to daily plan...')

    const resSub = await fetch(`${baseUrl}/openagentpay/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan_id: 'daily-unlimited',
        payer_identifier: 'mock-agent-demo',
      }),
    })

    const bodySub = await resSub.json()
    const subToken = bodySub.token
    console.log(`  POST /openagentpay/subscribe { plan_id: "daily-unlimited" }`)
    console.log(`  \u2192 ${resSub.status} Created`)
    console.log(`  \u2192 Token: ${subToken}`)

    // =========================================================================
    // Step 5 — Agent uses subscription (3 calls, no per-call payment)
    // =========================================================================
    step(5, 'Agent uses subscription (3 calls, no payment)...')

    for (let i = 0; i < 3; i++) {
      const resSubCall = await fetch(`${baseUrl}/api/data`, {
        headers: { 'X-SUBSCRIPTION': subToken },
      })
      totalCalls++
      paidSubscription++

      console.log(`  GET /api/data (with X-SUBSCRIPTION) \u2192 ${resSubCall.status} OK`)
      // Drain body
      await resSubCall.json()
    }

    // =========================================================================
    // Step 6 — Agent unsubscribes
    // =========================================================================
    step(6, 'Agent unsubscribes...')

    const resUnsub = await fetch(`${baseUrl}/openagentpay/unsubscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SUBSCRIPTION': subToken,
      },
    })

    console.log(`  POST /openagentpay/unsubscribe \u2192 ${resUnsub.status} OK`)
    await resUnsub.json()

    // =========================================================================
    // Step 7 — Summary
    // =========================================================================
    header('Summary')
    console.log(`  Total API calls:        ${totalCalls + 1}`) // +1 for the unsub
    console.log(`  Paid (per-call):        ${paidPerCall}`)
    console.log(`  Paid (subscription):    ${paidSubscription}`)
    console.log(`  Free (402 responses):   ${freeResponses}`)
    console.log(`  Subscription plan:      daily-unlimited ($0.50/day)`)
    console.log(`  Wallet balance:         $${wallet.getBalance()}`)
    console.log()
    console.log('  Demo complete!')
    console.log(LINE)
    console.log()
  } finally {
    // =========================================================================
    // Step 8 — Shut down server
    // =========================================================================
    server.close()
  }
}

main().catch((err) => {
  console.error('Demo failed:', err)
  process.exit(1)
})
