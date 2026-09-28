import { Module } from '@nestjs/common';
import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';
import { TasksController } from '../tasks/tasks.controller';
import { TasksService } from '../tasks/tasks.service';
import { CatalogController } from '../catalog/catalog.controller';
import { PlaybooksController } from './playbooks.controller';
import { PlaybooksService } from './playbooks.service';
import { TagsService } from './tags.service';

@Module({
  controllers: [CasesController, TasksController, CatalogController, PlaybooksController],
  providers: [CasesService, TasksService, PlaybooksService, TagsService],
  exports: [CasesService, PlaybooksService, TagsService],
})
export class CasesModule {}
