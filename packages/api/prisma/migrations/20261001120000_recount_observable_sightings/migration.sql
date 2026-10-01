-- Deleting a case did not recount its indicators, so an indicator kept counting
-- sightings on cases nobody can open any more, and the dashboard's Recurring
-- Indicators listed it with the old number. The API now recounts on delete;
-- this brings existing counts back in line once.
--
-- The noisy flag is left alone: its threshold is runtime configuration, and the
-- API re-evaluates it the next time the indicator is touched.
UPDATE "observable" AS o
SET "sightingCount" = counted.n
FROM (
  SELECT o2."id", COUNT(c."id")::integer AS n
  FROM "observable" o2
  LEFT JOIN "case_observable" co ON co."observableId" = o2."id"
  LEFT JOIN "case" c ON c."id" = co."caseId" AND c."deletedAt" IS NULL
  GROUP BY o2."id"
) AS counted
WHERE o."id" = counted."id"
  AND o."sightingCount" <> counted.n;
