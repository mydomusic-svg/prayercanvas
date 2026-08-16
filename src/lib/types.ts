export type Privacy = "private" | "unlisted" | "public";

export type RenderStatus = "pending" | "processing" | "complete" | "failed";

export type TextStyle = "calligraphy" | "modern" | "handwritten";

export type AccentColor = "gold" | "rose" | "sky" | "sage" | "ivory";

export interface CaptionSegment {
  text: string;
  start: number;
  end: number;
}

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

export interface Prayer {
  id: string;
  user_id: string;
  recipient_name: string | null;
  // Whether recipient_name is allowed to show up in the generated title and
  // get burned into the rendered video/thumbnail (see 0013 migration) — off
  // by default so a prayer stays generic enough to reshare with anyone.
  include_recipient_in_title: boolean;
  occasion: string | null;
  title: string | null;
  transcript: string | null;
  theme: string | null;
  captions: CaptionSegment[] | null;
  word_timings: WordTiming[] | null;
  style_id: string | null;
  music_style_id: string | null;
  // Set when the user uploaded their own photo instead of picking a library
  // style — the render worker turns it into a Ken Burns pan/zoom background
  // instead of downloading a library video (see 0012_photo_upload.sql).
  photo_asset_url: string | null;
  text_style: TextStyle;
  accent_color: AccentColor | null;
  privacy: Privacy;
  created_at: string;
}

export interface Style {
  id: string;
  name: string;
  visual_asset: string;
  music_asset: string;
  caption_template: string | null;
  category: string | null;
  source: string | null;
  license: string | null;
}

// Background music, chosen independently of the visual style (see
// supabase/migrations/0010_music_styles.sql, 0011_asset_library.sql).
export interface MusicStyle {
  id: string;
  name: string;
  music_asset: string | null;
  category: string | null;
  source: string | null;
  license: string | null;
}

// Curated stock-photo library (see supabase/migrations/0014_photo_styles.sql
// and scripts/seed-photo-library.mjs) — an alternative to uploading your own
// photo for the Ken Burns background. Picking one just sets
// prayers.photo_asset_url directly to image_asset, since it's already
// hosted in the public style-assets bucket.
export interface PhotoStyle {
  id: string;
  name: string;
  image_asset: string;
  category: string | null;
  source: string | null;
  license: string | null;
}

export interface RenderJob {
  id: string;
  prayer_id: string;
  status: RenderStatus;
  progress: number;
  error: string | null;
  output_url: string | null;
  thumbnail_url: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface ShareLink {
  id: string;
  prayer_id: string;
  token: string;
  expires_at: string | null;
  view_count: number;
  created_at: string;
}
