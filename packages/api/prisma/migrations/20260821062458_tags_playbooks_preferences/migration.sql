-- DropIndex
DROP INDEX "case_title_trgm_idx";

-- DropIndex
DROP INDEX "observable_normalized_value_trgm_idx";

-- AlterTable
ALTER TABLE "case_task" ADD COLUMN     "templateItemId" UUID;

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "preferences" JSONB;

-- CreateTable
CREATE TABLE "tag" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#64748b',
    "isSuggested" BOOLEAN NOT NULL DEFAULT false,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_template" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "matchTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "matchCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_template_item" (
    "id" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "task_template_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tag_name_key" ON "tag"("name");

-- CreateIndex
CREATE INDEX "tag_isSuggested_usageCount_idx" ON "tag"("isSuggested", "usageCount" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "task_template_name_key" ON "task_template"("name");

-- CreateIndex
CREATE INDEX "task_template_isActive_sortOrder_idx" ON "task_template"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "task_template_item_templateId_sortOrder_idx" ON "task_template_item"("templateId", "sortOrder");

-- CreateIndex
CREATE INDEX "case_task_templateItemId_idx" ON "case_task"("templateItemId");

-- AddForeignKey
ALTER TABLE "task_template" ADD CONSTRAINT "task_template_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_template_item" ADD CONSTRAINT "task_template_item_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "task_template"("id") ON DELETE CASCADE ON UPDATE CASCADE;
