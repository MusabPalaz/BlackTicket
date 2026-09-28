import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Length, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Request } from 'express';
import type { User } from '@prisma/client';
import { Permission } from '@black-ticket/shared';
import { CurrentUser, RequirePermissions } from '../../common/decorators/auth.decorators';
import { PlaybooksService } from './playbooks.service';
import { TagsService } from './tags.service';

class PlaybookItemDto {
  @ApiProperty()
  @IsString()
  @Length(2, 200)
  title!: string;

  @ApiPropertyOptional({ description: 'The question the analyst answers' })
  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  prompt?: string;
}

class UpsertPlaybookDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty()
  @IsString()
  @Length(2, 100)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'Applied to every case' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  matchTags?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Category slugs' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  matchCategories?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiProperty({ type: [PlaybookItemDto] })
  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => PlaybookItemDto)
  items!: PlaybookItemDto[];
}

class ApplyPlaybookDto {
  @ApiPropertyOptional({ type: [String], description: 'Omit to apply whatever matches the case' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID(undefined, { each: true })
  templateIds?: string[];
}

class UpsertTagDto {
  @ApiProperty()
  @IsString()
  @Length(1, 40)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(9)
  color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isSuggested?: boolean;
}

@ApiTags('playbooks')
@Controller()
export class PlaybooksController {
  constructor(
    private readonly playbooks: PlaybooksService,
    private readonly tags: TagsService,
  ) {}

  private actor(user: User, request: Request) {
    return { id: user.id, ip: request.ip ?? null, userAgent: request.get('user-agent') ?? null };
  }

  // ------------------------------------------------------------- analyst use

  @Get('tags')
  @RequirePermissions(Permission.CASE_READ)
  @ApiOperation({ summary: 'Suggested and previously used tags, most used first' })
  listTags(@Query('q') q?: string) {
    return this.tags.list(q);
  }

  @Get('task-templates')
  @RequirePermissions(Permission.CASE_READ)
  @ApiOperation({ summary: 'Available playbooks and the questions they ask' })
  listTemplates() {
    return this.playbooks.list();
  }

  @Post('cases/:id/playbooks')
  @RequirePermissions(Permission.TASK_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Add a playbook checklist to a case; items already present are skipped',
  })
  apply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApplyPlaybookDto,
    @CurrentUser() user: User,
    @Req() request: Request,
  ) {
    return this.playbooks.apply(id, dto.templateIds ?? 'auto', this.actor(user, request));
  }

  // ------------------------------------------------------------------- admin

  @Get('admin/task-templates')
  @RequirePermissions(Permission.TAXONOMY_MANAGE)
  @ApiOperation({ summary: 'All playbooks, including the inactive ones' })
  listAll() {
    return this.playbooks.list(true);
  }

  @Post('admin/task-templates')
  @RequirePermissions(Permission.TAXONOMY_MANAGE)
  @ApiOperation({ summary: 'Create or replace a playbook' })
  upsert(@Body() dto: UpsertPlaybookDto, @CurrentUser() user: User, @Req() request: Request) {
    return this.playbooks.upsert(dto, this.actor(user, request));
  }

  @Delete('admin/task-templates/:id')
  @RequirePermissions(Permission.TAXONOMY_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a playbook. Tasks it already created stay.' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User, @Req() request: Request) {
    await this.playbooks.remove(id, this.actor(user, request));
  }

  @Post('admin/tags')
  @RequirePermissions(Permission.TAXONOMY_MANAGE)
  @ApiOperation({ summary: 'Add or update a suggested tag' })
  upsertTag(@Body() dto: UpsertTagDto) {
    return this.tags.upsertSuggested(dto);
  }

  @Delete('admin/tags/:name')
  @RequirePermissions(Permission.TAXONOMY_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a tag from the catalogue. Cases keep theirs.' })
  async removeTag(@Param('name') name: string) {
    await this.tags.remove(name);
  }
}
