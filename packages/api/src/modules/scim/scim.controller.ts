import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ApiKeyScope } from '@black-ticket/shared';
import { Public } from '../../common/decorators/auth.decorators';
import { RequireApiKeyScopes } from '../../common/decorators/api-key.decorators';
import { ApiKeyGuard, type RequestWithApiKey } from '../../common/guards/api-key.guard';
import { ScimExceptionFilter } from './scim-exception.filter';
import { ScimService, type ScimActor } from './scim.service';
import { SCIM_PATCH_SCHEMA, SCIM_USER_SCHEMA } from './scim.types';

/**
 * SCIM 2.0, the door the corporate directory pushes accounts through.
 *
 * `@Public()` means "no user session"; the key guard is what authenticates,
 * and the scope is what keeps an alert-ingest token from reaching it.
 *
 * Bodies arrive as plain objects rather than validated DTOs on purpose. A
 * provisioning client sends a great deal of optional schema, and the global
 * pipe runs with `forbidNonWhitelisted`, so a DTO here would reject perfectly
 * valid SCIM for carrying fields this system does not store.
 */
@ApiExcludeController()
@Controller('scim/v2')
@Public()
@UseFilters(ScimExceptionFilter)
@UseGuards(ApiKeyGuard)
@RequireApiKeyScopes(ApiKeyScope.SCIM_MANAGE)
export class ScimController {
  constructor(private readonly scim: ScimService) {}

  private actorOf(request: RequestWithApiKey): ScimActor {
    return {
      keyId: request.apiKey.id,
      keyName: request.apiKey.name,
      ip: request.ip ?? null,
      userAgent: request.get('user-agent') ?? null,
    };
  }

  /** Absolute location the provider echoes back in `meta.location`. */
  private baseUrl(request: RequestWithApiKey): string {
    return `${request.protocol}://${request.get('host') ?? 'localhost'}${request.baseUrl}`.replace(
      /\/$/,
      '',
    );
  }

  // ------------------------------------------------------------- discovery

  @Get('ServiceProviderConfig')
  serviceProviderConfig() {
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      documentationUri: 'https://datatracker.ietf.org/doc/html/rfc7644',
      patch: { supported: true },
      // Declared unsupported rather than half-implemented: a provider that is
      // told bulk works will use it, and a partial implementation would fail
      // halfway through someone's first 600-account sync.
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 200 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: 'oauthbearertoken',
          name: 'OAuth Bearer Token',
          description: 'An API key with the scim:manage scope, sent as a bearer token.',
        },
      ],
    };
  }

  @Get('ResourceTypes')
  resourceTypes() {
    return {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: 1,
      itemsPerPage: 1,
      startIndex: 1,
      Resources: [
        {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
          id: 'User',
          name: 'User',
          endpoint: '/Users',
          description: 'Black Ticket account',
          schema: SCIM_USER_SCHEMA,
        },
      ],
    };
  }

  @Get('Schemas')
  schemas() {
    return {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: 2,
      itemsPerPage: 2,
      startIndex: 1,
      Resources: [{ id: SCIM_USER_SCHEMA }, { id: SCIM_PATCH_SCHEMA }],
    };
  }

  // ----------------------------------------------------------------- users

  @Get('Users')
  list(
    @Query('filter') filter: string | undefined,
    @Query('startIndex') startIndex: string | undefined,
    @Query('count') count: string | undefined,
    @Req() request: RequestWithApiKey,
  ) {
    return this.scim.list({ filter, startIndex, count }, this.baseUrl(request));
  }

  @Get('Users/:id')
  get(@Param('id') id: string, @Req() request: RequestWithApiKey) {
    return this.scim.get(id, this.baseUrl(request));
  }

  @Post('Users')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() body: Record<string, unknown>, @Req() request: RequestWithApiKey) {
    return this.scim.create(body, this.actorOf(request), this.baseUrl(request));
  }

  @Put('Users/:id')
  replace(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() request: RequestWithApiKey,
  ) {
    return this.scim.replace(id, body, this.actorOf(request), this.baseUrl(request));
  }

  @Patch('Users/:id')
  patch(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() request: RequestWithApiKey,
  ) {
    return this.scim.patch(id, body, this.actorOf(request), this.baseUrl(request));
  }

  @Delete('Users/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @Req() request: RequestWithApiKey): Promise<void> {
    await this.scim.deactivate(id, this.actorOf(request));
  }
}
