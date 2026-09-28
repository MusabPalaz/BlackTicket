-- AlterTable
ALTER TABLE "user" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "user_tags_idx" ON "user" USING GIN ("tags");
