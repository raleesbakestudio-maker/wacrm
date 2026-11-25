import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';

// Official Meta WhatsApp Business Platform rates for India (INR, excl. 18% GST) per delivered message
const INDIA_RATES_INR = {
  marketing: 0.8631,
  utility: 0.115,
  authentication: 0.115,
  service: 0,
} as const;

type PricingBucket = {
  marketingCount: number;
  marketingCost: number;
  utilityCount: number;
  utilityCost: number;
  authCount: number;
  authCost: number;
  serviceCount: number;
  totalCost: number;
};

function emptyBucket(): PricingBucket {
  return {
    marketingCount: 0,
    marketingCost: 0,
    utilityCount: 0,
    utilityCost: 0,
    authCount: 0,
    authCost: 0,
    serviceCount: 0,
    totalCost: 0,
  };
}

function addMessageToBucket(
  bucket: PricingBucket,
  category: string,
  billable: boolean | null,
) {
  const cat = category.toLowerCase();
  if (billable === false || cat === 'service') {
    bucket.serviceCount += 1;
    return;
  }
  if (cat === 'marketing') {
    bucket.marketingCount += 1;
    bucket.marketingCost += INDIA_RATES_INR.marketing;
    bucket.totalCost += INDIA_RATES_INR.marketing;
  } else if (cat === 'utility') {
    bucket.utilityCount += 1;
    bucket.utilityCost += INDIA_RATES_INR.utility;
    bucket.totalCost += INDIA_RATES_INR.utility;
  } else if (cat === 'authentication') {
    bucket.authCount += 1;
    bucket.authCost += INDIA_RATES_INR.authentication;
    bucket.totalCost += INDIA_RATES_INR.authentication;
  } else {
    bucket.serviceCount += 1;
  }
}

interface MetaPricingPoint {
  start?: number;
  end?: number;
  pricing_category?: string;
  pricing_type?: string;
  volume?: number;
  cost?: number;
}

async function fetchMetaLiveAnalytics(
  wabaId: string,
  accessToken: string,
  startUnix: number,
  endUnix: number,
): Promise<PricingBucket | null> {
  try {
    const analyticsExpr = `pricing_analytics.start(${startUnix}).end(${endUnix}).granularity(DAILY).dimensions(["PRICING_CATEGORY","PRICING_TYPE"])`;
    const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(wabaId)}?fields=${encodeURIComponent(analyticsExpr)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(4500),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      pricing_analytics?: { data?: Array<{ data_points?: MetaPricingPoint[] }> };
    };
    const points = json?.pricing_analytics?.data?.[0]?.data_points;
    if (!Array.isArray(points) || points.length === 0) return null;

    const bucket = emptyBucket();

    for (const pt of points) {
      const vol = Number(pt.volume ?? 0);
      const cost = Number(pt.cost ?? 0);
      const cat = (pt.pricing_category ?? 'SERVICE').toUpperCase();
      const isFree =
        pt.pricing_type === 'FREE_CUSTOMER_SERVICE' ||
        pt.pricing_type === 'FREE_ENTRY_POINT' ||
        cat === 'SERVICE';

      if (isFree) {
        bucket.serviceCount += vol;
      } else if (cat === 'MARKETING') {
        bucket.marketingCount += vol;
        bucket.marketingCost += cost;
        bucket.totalCost += cost;
      } else if (cat === 'UTILITY') {
        bucket.utilityCount += vol;
        bucket.utilityCost += cost;
        bucket.totalCost += cost;
      } else if (cat === 'AUTHENTICATION') {
        bucket.authCount += vol;
        bucket.authCost += cost;
        bucket.totalCost += cost;
      } else {
        bucket.serviceCount += vol;
      }
    }

    return bucket;
  } catch {
    return null;
  }
}

function resolveDateRange(req: NextRequest): { start: Date; end: Date } {
  const { searchParams } = new URL(req.url);
  const preset = searchParams.get('preset') || 'month';
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  const now = new Date();

  if (preset === 'custom' && fromParam) {
    const parsedFrom = new Date(`${fromParam}T00:00:00`);
    const parsedTo = toParam ? new Date(`${toParam}T23:59:59.999`) : now;
    if (!Number.isNaN(parsedFrom.getTime()) && !Number.isNaN(parsedTo.getTime())) {
      const start = parsedFrom <= parsedTo ? parsedFrom : parsedTo;
      const end = parsedFrom <= parsedTo ? parsedTo : parsedFrom;
      return { start, end };
    }
  }

  if (preset === 'today') {
    return {
      start: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0),
      end: now,
    };
  }

  if (preset === '7d') {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0);
    return { start: d, end: now };
  }

  // Default: current month
  return {
    start: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0),
    end: now,
  };
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = supabaseAdmin();
    const { data: profile } = await admin
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!profile?.account_id) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    const accountId = profile.account_id;
    const { start, end } = resolveDateRange(request);

    const [configRes, templatesRes, messagesRes] = await Promise.all([
      admin
        .from('whatsapp_config')
        .select('waba_id, access_token')
        .eq('account_id', accountId)
        .maybeSingle(),
      admin
        .from('message_templates')
        .select('name, category')
        .eq('account_id', accountId),
      admin
        .from('messages')
        .select(
          'created_at, content_type, template_name, status, pricing_category, is_billable, conversations!inner(account_id)',
        )
        .eq('conversations.account_id', accountId)
        .in('sender_type', ['agent', 'bot'])
        .neq('status', 'failed')
        .gte('created_at', start.toISOString())
        .lte('created_at', end.toISOString())
        .limit(5000),
    ]);

    let metaLive: PricingBucket | null = null;
    const cfg = configRes.data;
    if (cfg?.waba_id && cfg?.access_token) {
      try {
        const accessToken = decrypt(cfg.access_token);
        metaLive = await fetchMetaLiveAnalytics(
          cfg.waba_id,
          accessToken,
          Math.floor(start.getTime() / 1000),
          Math.floor(end.getTime() / 1000),
        );
      } catch {
        // Fallback to CRM-tracked metrics
      }
    }

    const templateCategoryMap = new Map<string, string>();
    for (const t of (templatesRes.data ?? []) as Array<{ name: string; category: string }>) {
      if (t.name && t.category) {
        templateCategoryMap.set(t.name, t.category.toLowerCase());
      }
    }

    const crmBucket = emptyBucket();
    for (const m of (messagesRes.data ?? []) as Array<{
      created_at: string;
      content_type: string;
      template_name: string | null;
      pricing_category: string | null;
      is_billable: boolean | null;
    }>) {
      let category = m.pricing_category;
      let billable = m.is_billable;

      if (!category) {
        if (m.content_type === 'template' && m.template_name) {
          category = templateCategoryMap.get(m.template_name) ?? 'marketing';
          billable = true;
        } else {
          category = 'service';
          billable = false;
        }
      }

      addMessageToBucket(crmBucket, category, billable);
    }

    const useMetaLive =
      metaLive !== null &&
      (metaLive.totalCost > 0 || metaLive.serviceCount > 0);

    return NextResponse.json(
      {
        source: useMetaLive ? 'meta_live' : 'crm_tracked',
        currency: 'INR',
        rates: INDIA_RATES_INR,
        summary: useMetaLive ? metaLive : crmBucket,
      },
      {
        headers: {
          'Cache-Control': 'private, max-age=120',
        },
      },
    );
  } catch (err) {
    console.error('[whatsapp/billing] GET error:', err);
    return NextResponse.json({ error: 'Failed to load billing summary' }, { status: 500 });
  }
}
