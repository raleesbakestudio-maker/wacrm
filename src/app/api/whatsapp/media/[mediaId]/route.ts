import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'

// Fast in-memory cache for media to avoid repeated 8s downloads from Meta on every render
interface CachedMedia {
  buffer: Uint8Array
  contentType: string
  cachedAt: number
}
const mediaCache = new Map<string, CachedMedia>()
const MAX_CACHE_ITEMS = 150
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

export async function GET(
  request: Request,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  try {
    const { mediaId } = await params

    if (!mediaId) {
      return NextResponse.json(
        { error: 'Media ID is required' },
        { status: 400 }
      )
    }

    // Check memory cache first
    const cached = mediaCache.get(mediaId)
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return new Response(cached.buffer as unknown as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': cached.contentType,
          'Cache-Control': 'public, max-age=604800, immutable',
        },
      })
    }

    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Fetch and decrypt WhatsApp config — first by user_id, fallback to account_id
    let { data: config } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()

    if (!config) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('account_id')
        .eq('user_id', user.id)
        .maybeSingle()

      if (profile?.account_id) {
        const { data: accConfig } = await supabase
          .from('whatsapp_config')
          .select('*')
          .eq('account_id', profile.account_id)
          .maybeSingle()
        config = accConfig
      }
    }

    if (!config) {
      return NextResponse.json(
        { error: 'WhatsApp not configured' },
        { status: 400 }
      )
    }

    const accessToken = decrypt(config.access_token)

    // Get the download URL from Meta
    const mediaInfo = await getMediaUrl({ mediaId, accessToken })

    // Download the binary data
    const { buffer, contentType } = await downloadMedia({
      downloadUrl: mediaInfo.url,
      accessToken,
    })

    const finalContentType = contentType || mediaInfo.mimeType || 'application/octet-stream'
    const uint8Buf = new Uint8Array(buffer)

    // Cache in memory for subsequent requests
    if (mediaCache.size >= MAX_CACHE_ITEMS) {
      const oldestKey = mediaCache.keys().next().value
      if (oldestKey) mediaCache.delete(oldestKey)
    }
    mediaCache.set(mediaId, {
      buffer: uint8Buf,
      contentType: finalContentType,
      cachedAt: Date.now(),
    })

    return new Response(uint8Buf as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': finalContentType,
        'Cache-Control': 'public, max-age=604800, immutable',
      },
    })
  } catch (error) {
    console.error('Error in WhatsApp media GET:', error)
    return NextResponse.json(
      { error: 'Failed to fetch media' },
      { status: 500 }
    )
  }
}
