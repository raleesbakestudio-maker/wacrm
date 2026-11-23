import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    }

    // Determine extension based on MIME type
    let ext = 'ogg';
    const mime = file.type || '';
    if (mime.includes('mp4') || mime.includes('m4a')) {
      ext = 'm4a';
    } else if (mime.includes('webm')) {
      ext = 'webm';
    } else if (mime.includes('mpeg') || mime.includes('mp3')) {
      ext = 'mp3';
    } else if (mime.includes('wav')) {
      ext = 'wav';
    } else if (mime.includes('aac')) {
      ext = 'aac';
    }

    const filename = `voice-note-${Date.now()}.${ext}`;
    const storagePath = `${user.id}/voice-notes/${filename}`;

    const admin = supabaseAdmin();
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { data: uploadData, error: uploadErr } = await admin.storage
      .from('flow-media')
      .upload(storagePath, buffer, {
        contentType: mime || 'audio/ogg',
        upsert: true,
      });

    if (uploadErr || !uploadData) {
      console.error('Failed to upload voice note to storage:', uploadErr);
      return NextResponse.json(
        { error: uploadErr?.message || 'Storage upload failed' },
        { status: 500 },
      );
    }

    const {
      data: { publicUrl },
    } = admin.storage.from('flow-media').getPublicUrl(uploadData.path);

    return NextResponse.json({
      url: publicUrl,
      filename,
      contentType: mime || 'audio/ogg',
    });
  } catch (err) {
    console.error('Voice upload error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Server error' },
      { status: 500 },
    );
  }
}
