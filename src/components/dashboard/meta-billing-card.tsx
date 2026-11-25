'use client'

import { useCallback, useEffect, useState } from 'react'
import { IndianRupee, RefreshCw, Megaphone, Bell, MessageCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PricingBucket {
  marketingCount: number
  marketingCost: number
  utilityCount: number
  utilityCost: number
  authCount: number
  authCost: number
  serviceCount: number
  totalCost: number
}

interface BillingResponse {
  source: 'meta_live' | 'crm_tracked'
  currency: string
  rates: {
    marketing: number
    utility: number
    authentication: number
    service: number
  }
  today: PricingBucket
  month: PricingBucket
}

function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: amount > 0 && amount < 10 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function MetaBillingCard() {
  const [data, setData] = useState<BillingResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [period, setPeriod] = useState<'month' | 'today'>('month')

  const loadBilling = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    try {
      const res = await fetch('/api/whatsapp/billing', {
        cache: isRefresh ? 'no-store' : 'default',
      })
      if (!res.ok) return
      const json = (await res.json()) as BillingResponse
      setData(json)
    } catch {
      // Non-fatal: dashboard stays clean if billing fetch fails
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void loadBilling(false)
  }, [loadBilling])

  const active = data ? (period === 'today' ? data.today : data.month) : null
  const utilityAuthCount = active ? active.utilityCount + active.authCount : 0
  const utilityAuthCost = active ? active.utilityCost + active.authCost : 0

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 sm:p-5">
      {/* Header — stacks cleanly on 375px mobile, single row on sm+ */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
            <IndianRupee className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-semibold text-white truncate">
                Meta WhatsApp Billing
              </h2>
              {data && (
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border',
                    data.source === 'meta_live'
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                      : 'border-sky-500/30 bg-sky-500/10 text-sky-400',
                  )}
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      data.source === 'meta_live' ? 'bg-emerald-400' : 'bg-sky-400',
                    )}
                  />
                  {data.source === 'meta_live' ? 'Meta Live' : 'CRM Tracked'}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 truncate">
              {period === 'today' ? 'Today’s' : 'This month’s'} message charges &amp; free replies
            </p>
          </div>
        </div>

        {/* Period toggle + refresh */}
        <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
          <div className="inline-flex rounded-lg border border-slate-800 bg-slate-950/70 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setPeriod('today')}
              className={cn(
                'rounded-md px-2.5 py-1 font-medium transition-colors cursor-pointer',
                period === 'today'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-slate-200',
              )}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setPeriod('month')}
              className={cn(
                'rounded-md px-2.5 py-1 font-medium transition-colors cursor-pointer',
                period === 'month'
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-slate-200',
              )}
            >
              This Month
            </button>
          </div>

          <button
            type="button"
            onClick={() => void loadBilling(true)}
            disabled={refreshing}
            aria-label="Refresh Meta billing"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-950/70 text-slate-400 hover:text-white hover:border-slate-700 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Metrics grid — 2x2 on mobile, 4 columns on desktop */}
      {loading ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-lg border border-slate-800/80 bg-slate-950/50"
            />
          ))}
        </div>
      ) : active ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {/* Total Cost */}
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/10 p-3">
            <p className="text-[11px] font-medium text-slate-400">
              {data?.source === 'meta_live' ? 'Total Cost' : 'Est. Total Cost'}
            </p>
            <p className="mt-1 text-lg sm:text-xl font-bold text-white tabular-nums">
              {formatINR(active.totalCost)}
            </p>
            <p className="mt-0.5 text-[11px] text-emerald-400/90 tabular-nums">
              {(active.marketingCount + utilityAuthCount).toLocaleString()} paid msgs
            </p>
          </div>

          {/* Marketing */}
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
            <div className="flex items-center justify-between gap-1">
              <p className="text-[11px] font-medium text-slate-400">Marketing</p>
              <Megaphone className="h-3.5 w-3.5 text-purple-400 shrink-0" />
            </div>
            <p className="mt-1 text-lg sm:text-xl font-bold text-white tabular-nums">
              {formatINR(active.marketingCost)}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400 tabular-nums">
              {active.marketingCount.toLocaleString()} msgs
            </p>
          </div>

          {/* Utility & Auth */}
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
            <div className="flex items-center justify-between gap-1">
              <p className="text-[11px] font-medium text-slate-400">Utility &amp; Auth</p>
              <Bell className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            </div>
            <p className="mt-1 text-lg sm:text-xl font-bold text-white tabular-nums">
              {formatINR(utilityAuthCost)}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400 tabular-nums">
              {utilityAuthCount.toLocaleString()} msgs
            </p>
          </div>

          {/* Free Service Replies */}
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
            <div className="flex items-center justify-between gap-1">
              <p className="text-[11px] font-medium text-slate-400">Free (24h Chat)</p>
              <MessageCircle className="h-3.5 w-3.5 text-sky-400 shrink-0" />
            </div>
            <p className="mt-1 text-lg sm:text-xl font-bold text-emerald-400 tabular-nums">
              ₹0
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400 tabular-nums">
              {active.serviceCount.toLocaleString()} free msgs
            </p>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-xs text-slate-500">
          Connect your WhatsApp Business account in Settings to view Meta billing.
        </p>
      )}

      {/* Compact rate legend */}
      {data && (
        <p className="mt-3 text-[11px] text-slate-500 leading-relaxed">
          India Meta rates: Marketing ~₹{data.rates.marketing}/msg · Utility/Auth ~₹
          {data.rates.utility}/msg · 24h customer replies ₹0 (Free).
        </p>
      )}
    </div>
  )
}
