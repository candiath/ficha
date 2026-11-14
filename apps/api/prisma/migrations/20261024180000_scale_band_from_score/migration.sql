-- A functional scale stored its band as a Spanish sentence ("Discapacidad
-- moderada (21–40%)"): rewording it, or fixing a threshold, would have left
-- every earlier row with the old text. The band is now derived from the score
-- when read (src/lib/scaleBands.ts) and the screen words it. Dropped in one
-- release: production is wiped before the relaunch (#238).
ALTER TABLE "functional_scales" DROP COLUMN "interpretation";
