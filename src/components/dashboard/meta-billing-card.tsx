'use client'

import { useCallback, useEffect, useState } from 'react'
import { IndianRupee, RefreshCw, Megaphone, Bell, MessageCircle, Calendar } from 'lucide-react'
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
  summary: PricingBucket
}

type DatePreset = 'today' | '7d' | 'month' | 'custom'

const PRESETS: { id: DatePreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7 Days' },
  { id: 'month', label: 'Month' },
  { id: 'custom', label: 'Custom' },
]

function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: amount > 0 && amount < 10 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(amount)
}

function localDateInputDefault(daysAgo = 0): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function MetaBillingCard() {
  const [data, setData] = useState<BillingResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [preset, setPreset] = useState<DatePreset>('month')
  const [fromDate, setFromDate] = useState(() => localDateInputDefault(7))
  const [toDate, setToDate] = useState(() => localDateInputDefault(0))

  const loadBilling = useCallback(
    async (opts: { isRefresh?: boolean; p?: DatePreset; from?: string; to?: string } = {}) => {
      const activePreset = opts.p ?? preset
      const activeFrom = opts.from ?? fromDate
      const activeTo = opts.to ?? toDate

      if (opts.isRefresh) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }

      try {
        const params = new URLSearchParams({ preset: activePreset })
        if (activePreset === 'custom') {
          if (!activeFrom) return
          params.set('from', activeFrom)
          if (activeTo) params.set('to', activeTo)
        }
        const res = await fetch(`/api/whatsapp/billing?${params.toString()}`, {
          cache: opts.isRefresh ? 'no-store' : 'default',
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
    },
    [preset, fromDate, toDate],
  )

  useEffect(() => {
    void loadBilling({ isRefresh: false })
  }, [loadBilling])

  const active = data?.summary ?? null
  const utilityAuthCount = active ? active.utilityCount + active.authCount : 0
  const utilityAuthCost = active ? active.utilityCost + active.authCost : 0

  const subtitleText =
    preset === 'today'
      ? "Today's message charges & free replies"
      : preset === '7d'
        ? 'Last 7 days message charges & free replies'
        : preset === 'custom'
          ? `${fromDate} to ${toDate || fromDate}`
          : "This month's message charges & free replies"

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
      {/* Header — stacks cleanly on 375px mobile, single row on lg+ */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
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
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
                      : 'border-sky-500/30 bg-sky-500/10 text-sky-500',
                  )}
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      data.source === 'meta_live' ? 'bg-emerald-500' : 'bg-sky-500',
                    )}
                  />
                  {data.source === 'meta_live' ? 'Meta Live' : 'CRM Tracked'}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 truncate">{subtitleText}</p>
          </div>
        </div>

        {/* Date Filter Pills + Refresh */}
        <div className="flex items-center justify-between lg:justify-end gap-2 flex-wrap">
          <div className="inline-flex items-center rounded-lg border border-slate-800 bg-slate-950 p-0.5 text-xs">
            {PRESETS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setPreset(item.id)}
                className={cn(
                  'rounded-md px-2.5 py-1 font-medium transition-colors cursor-pointer whitespace-nowrap',
                  preset === item.id
                    ? 'bg-slate-800 text-white shadow-xs'
                    : 'text-slate-400 hover:text-white',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void loadBilling({ isRefresh: true })}
            disabled={refreshing}
            aria-label="Refresh Meta billing"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-slate-950 text-slate-400 hover:text-white hover:border-slate-700 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Custom Date Range Inputs */}
      {preset === 'custom' && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 p-2.5 text-xs">
          <div className="flex items-center gap-1.5 text-slate-400">
            <Calendar className="h-3.5 w-3.5 text-primary shrink-0" />
            <span>Range:</span>
          </div>
          <input
            type="date"
            value={fromDate}
            max={toDate || undefined}
            onChange={(e) => setFromDate(e.target.value)}
            aria-label="From date"
            className="rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <span className="text-slate-500">to</span>
          <input
            type="date"
            value={toDate}
            min={fromDate || undefined}
            max={localDateInputDefault(0)}
            onChange={(e) => setToDate(e.target.value)}
            aria-label="To date"
            className="rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      )}

      {/* Metrics grid — 2x2 on mobile, 4 columns on desktop */}
      {loading ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-lg border border-slate-800 bg-slate-800/50"
            />
          ))}
        </div>
      ) : active ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {/* Total Cost */}
          <div className="rounded-lg border border-primary/25 bg-primary/5 p-3">
            <p className="text-[11px] font-medium text-slate-400">
              {data?.source === 'meta_live' ? 'Total Cost' : 'Est. Total Cost'}
            </p>
            <p className="mt-1 text-lg sm:text-xl font-bold text-white tabular-nums">
              {formatINR(active.totalCost)}
            </p>
            <p className="mt-0.5 text-[11px] font-medium text-primary tabular-nums">
              {(active.marketingCount + utilityAuthCount).toLocaleString()} paid msgs
            </p>
          </div>

          {/* Marketing */}
          <div className="rounded-lg border border-slate-800 bg-slate-800/50 p-3">
            <div className="flex items-center justify-between gap-1">
              <p className="text-[11px] font-medium text-slate-400">Marketing</p>
              <Megaphone className="h-3.5 w-3.5 text-purple-500 shrink-0" />
            </div>
            <p className="mt-1 text-lg sm:text-xl font-bold text-white tabular-nums">
              {formatINR(active.marketingCost)}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400 tabular-nums">
              {active.marketingCount.toLocaleString()} msgs
            </p>
          </div>

          {/* Utility & Auth */}
          <div className="rounded-lg border border-slate-800 bg-slate-800/50 p-3">
            <div className="flex items-center justify-between gap-1">
              <p className="text-[11px] font-medium text-slate-400">Utility &amp; Auth</p>
              <Bell className="h-3.5 w-3.5 text-amber-500 shrink-0" />
            </div>
            <p className="mt-1 text-lg sm:text-xl font-bold text-white tabular-nums">
              {formatINR(utilityAuthCost)}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400 tabular-nums">
              {utilityAuthCount.toLocaleString()} msgs
            </p>
          </div>

          {/* Free Service Replies */}
          <div className="rounded-lg border border-slate-800 bg-slate-800/50 p-3">
            <div className="flex items-center justify-between gap-1">
              <p className="text-[11px] font-medium text-slate-400">Free (24h Chat)</p>
              <MessageCircle className="h-3.5 w-3.5 text-sky-500 shrink-0" />
            </div>
            <p className="mt-1 text-lg sm:text-xl font-bold text-emerald-500 tabular-nums">
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
          India Meta rates (excl. 18% GST): Marketing ₹{data.rates.marketing}/msg · Utility/Auth ₹
          {data.rates.utility}/msg · 24h customer replies ₹0 (Free).
        </p>
      )}
    </div>
  )
}
