-- Sprint 3.8: lets the user pick a text style (font) and accent color for
-- the title before the video is generated, instead of always defaulting to
-- the calligraphy look introduced in 0007. Both are applied to the title in
-- the rendered video itself and to the poster thumbnail, so the two match.
alter table public.prayers
  add column if not exists text_style text not null default 'calligraphy',
  add column if not exists accent_color text;

alter table public.prayers
  add constraint prayers_text_style_check
    check (text_style in ('calligraphy', 'modern', 'handwritten'));

alter table public.prayers
  add constraint prayers_accent_color_check
    check (accent_color is null or accent_color in ('gold', 'rose', 'sky', 'sage', 'ivory'));
