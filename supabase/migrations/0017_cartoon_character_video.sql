-- Lets a cartoon character be an animated CLIP rather than a still portrait.
--
-- 0015 gave each character a single image_asset, which the render worker
-- turned into a Ken Burns pan/zoom so it wasn't completely frozen on screen.
-- With real animations available, the character can just move.
--
-- image_asset stays REQUIRED and keeps its job: it is the thumbnail in the
-- create page's character picker (a grid of tiny autoplaying videos would be
-- miserable on mobile data), and it is the fallback the worker uses for any
-- character that has no clip yet. video_asset is purely additive — existing
-- rows keep working untouched.
alter table public.cartoon_characters
  add column if not exists video_asset text;
