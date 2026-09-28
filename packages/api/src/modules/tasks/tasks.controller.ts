import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { User } from '@prisma/client';
import { Permission } from '@black-ticket/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators';
import type { ActorContext } from '../cases/cases.service';
import { TasksService } from './tasks.service';
import { CreateTaskDto, CreateTaskLogDto, UpdateTaskDto } from './dto/task.dto';

function actorOf(user: User, request: Request): ActorContext {
  return { user, ip: request.ip ?? null, userAgent: request.get('user-agent') ?? null };
}

@ApiTags('tasks')
@Controller()
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get('cases/:caseId/tasks')
  @RequirePermissions(Permission.CASE_READ)
  @ApiOperation({ summary: 'Tasks of a case, in working order' })
  list(@Param('caseId', ParseUUIDPipe) caseId: string) {
    return this.tasks.list(caseId);
  }

  @Post('cases/:caseId/tasks')
  @RequirePermissions(Permission.TASK_MANAGE)
  @ApiOperation({ summary: 'Add a task to a case' })
  create(
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() dto: CreateTaskDto,
    @CurrentUser() user: User,
    @Req() request: Request,
  ) {
    return this.tasks.create(caseId, dto, actorOf(user, request));
  }

  @Patch('tasks/:id')
  @RequirePermissions(Permission.TASK_MANAGE)
  @ApiOperation({ summary: 'Update a task; timestamps follow the status' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
    @CurrentUser() user: User,
    @Req() request: Request,
  ) {
    return this.tasks.update(id, dto, actorOf(user, request));
  }

  @Get('tasks/:id/logs')
  @RequirePermissions(Permission.CASE_READ)
  @ApiOperation({ summary: 'Work log of a task' })
  listLogs(@Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.listLogs(id);
  }

  @Post('tasks/:id/logs')
  @RequirePermissions(Permission.TASK_MANAGE)
  @ApiOperation({ summary: 'Append a note; entries are permanent' })
  addLog(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateTaskLogDto,
    @CurrentUser() user: User,
    @Req() request: Request,
  ) {
    return this.tasks.addLog(id, dto.body, actorOf(user, request));
  }
}
