import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { dataGovApi } from '@/lib/api/data-gov/client';
import { cbsApi } from '@/lib/api/cbs/client';
import {
  buildDatasetPortalUrl,
  buildResourcePortalUrl,
} from '@/constants/datagov-urls';

const SERVER_INSTRUCTIONS = `You are connected to the Data Israel MCP server — a gateway to Israeli open government data from two sources:

## Data Sources

1. **data.gov.il** — Israel's national open data portal (CKAN API). Contains thousands of datasets from government ministries and agencies.
2. **CBS (הלמ"ס)** — Israel's Central Bureau of Statistics. Contains time series, price indices, CPI data, and geographic/locality information.

## Recommended Workflows

### Finding data on data.gov.il
1. Start with \`searchDatasets\` using 1-2 Hebrew keywords (e.g., "תחבורה", "חינוך")
2. Use \`getDatasetDetails\` to inspect a dataset's metadata and resources
3. Use \`queryDatastoreResource\` to query actual tabular data from a resource ID
4. Use \`generateDataGovSourceUrl\` to provide the user a clickable link to the portal

### Finding CBS statistical data
1. Start with \`browseCbsCatalog\` at level 1 to see top-level categories
2. Drill down with higher levels or \`browseCbsCatalogPath\` using comma-separated path codes
3. Use \`getCbsSeriesData\` with a series ID to get actual data points
4. Use \`generateCbsSourceUrl\` to provide a clickable link

### Price indices & CPI
1. Use \`browseCbsPriceIndices\` with mode "chapters" to see available index categories
2. Drill into "topics" then "indices" to find specific index codes
3. Use \`getCbsPriceData\` for historical values, or \`calculateCbsPriceIndex\` to compute inflation-adjusted amounts between dates

### Localities / Geography
- Use \`searchCbsLocalities\` to find Israeli cities, towns, and villages by name

## Important Notes
- Dataset and resource names/IDs on data.gov.il are often in Hebrew
- CBS catalog paths are numeric codes (e.g., "2,1,1,2,379") — browse the hierarchy to discover them
- The \`lang\` parameter on CBS tools accepts "he" (Hebrew, default) or "en" (English)
- When presenting data to users, always include a source URL using the generate*SourceUrl tools
- Use \`queryDatastoreResource\` for actual data queries — \`getDatasetDetails\` only returns metadata`;

function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'data-israel', version: '0.1.0' },
    { instructions: SERVER_INSTRUCTIONS },
  );

  registerDataGovTools(server);
  registerCbsTools(server);

  return server;
}

function textResult(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text' as const, text: `Error: ${message}` }],
    isError: true,
  };
}

function registerDataGovTools(server: McpServer): void {
  server.tool(
    'searchDatasets',
    'Search for datasets on data.gov.il by query, organization, or tag.',
    {
      query: z.string().describe('Search query (1-2 keywords)'),
      organization: z.string().optional().describe('Filter by organization ID'),
      tag: z.string().optional().describe('Filter by tag name'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe('Results to return (default 10)'),
    },
    async ({ query, organization, tag, limit }) => {
      try {
        let q = query;
        if (organization) q += ` organization:${organization}`;
        if (tag) q += ` tags:${tag}`;
        const result = await dataGovApi.dataset.search({
          q,
          rows: limit ?? 10,
          start: 0,
        });
        return textResult({ count: result.count, datasets: result.results });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.tool(
    'listAllDatasets',
    'Get all dataset IDs available on data.gov.il.',
    {},
    async () => {
      try {
        const ids = await dataGovApi.dataset.list();
        return textResult({ count: ids.length, datasetIds: ids });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.tool(
    'getDatasetDetails',
    'Get full metadata for a specific dataset.',
    { id: z.string().describe('Dataset ID or name') },
    async ({ id }) => {
      try {
        const result = await dataGovApi.dataset.show(id);
        return textResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.tool(
    'getDatasetActivity',
    'Get the activity/change history of a dataset.',
    {
      id: z.string().describe('Dataset ID'),
      offset: z.number().int().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    async ({ id, offset, limit }) => {
      try {
        const result = await dataGovApi.dataset.activity(id, {
          offset,
          limit,
        });
        return textResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.tool(
    'listOrganizations',
    'List all government organizations that publish data on data.gov.il.',
    {},
    async () => {
      try {
        const result = await dataGovApi.organization.list();
        return textResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.tool(
    'getOrganizationDetails',
    'Get metadata for a specific organization.',
    { id: z.string().describe('Organization ID or name') },
    async ({ id }) => {
      try {
        const result = await dataGovApi.organization.show(id);
        return textResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.tool(
    'getOrganizationActivity',
    'Get the activity stream of an organization.',
    {
      id: z.string().describe('Organization ID'),
      offset: z.number().int().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    async ({ id, offset, limit }) => {
      try {
        const result = await dataGovApi.organization.activity(id, {
          offset,
          limit,
        });
        return textResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.tool(
    'listGroups',
    'List dataset categories/groups.',
    {
      orderBy: z.enum(['name', 'package_count']).optional(),
      limit: z.number().int().optional(),
      offset: z.number().int().optional(),
      allFields: z.boolean().optional().describe('Include full details'),
    },
    async ({ orderBy, limit, offset, allFields }) => {
      try {
        const result = await dataGovApi.group.list({
          order_by: orderBy,
          limit,
          offset,
          all_fields: allFields,
        });
        return textResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.tool(
    'listTags',
    'List all tags used in datasets.',
    {
      query: z.string().optional().describe('Search within tags'),
      allFields: z.boolean().optional(),
    },
    async ({ query, allFields }) => {
      try {
        const result = await dataGovApi.tag.list({
          query,
          all_fields: allFields,
        });
        return textResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.tool(
    'listLicenses',
    'Get all available dataset licenses.',
    {},
    async () => {
      try {
        const result = await dataGovApi.system.licenses();
        return textResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.tool(
    'getStatus',
    'Get CKAN system status (version, extensions).',
    {},
    async () => {
      try {
        const result = await dataGovApi.system.status();
        return textResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.tool(
    'searchResources',
    'Search for resource files (CSV, JSON, etc.) across datasets.',
    {
      query: z.string().describe('Search keywords'),
      datasetId: z.string().optional().describe('Filter by dataset ID'),
      format: z.string().optional().describe('Filter by format (e.g., "csv")'),
      limit: z.number().int().min(1).max(100).optional(),
    },
    async ({ query, datasetId, format, limit }) => {
      try {
        const result = await dataGovApi.resource.search({
          query,
          ...(datasetId && { package_id: datasetId }),
          ...(format && { format }),
          limit,
        });
        return textResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.tool(
    'getResourceDetails',
    'Get metadata for a specific resource file.',
    { id: z.string().describe('Resource ID') },
    async ({ id }) => {
      try {
        const result = await dataGovApi.resource.show(id);
        return textResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.tool(
    'queryDatastoreResource',
    'Query tabular data within a DataStore resource. Supports filtering, full-text search, sorting, and pagination.',
    {
      resource_id: z.string().describe('Resource ID to query'),
      filters: z
        .record(z.string(), z.union([z.string(), z.number()]))
        .optional()
        .describe('Exact match filters (column: value)'),
      q: z.string().optional().describe('Full-text search query'),
      limit: z.number().int().min(1).max(50).optional(),
      offset: z.number().int().optional(),
      sort: z.string().optional().describe('Sort string (e.g., "column asc")'),
    },
    async ({ resource_id, filters, q, limit, offset, sort }) => {
      try {
        const result = await dataGovApi.datastore.search({
          resource_id,
          filters,
          q,
          limit,
          offset,
          sort,
        });
        return textResult({
          fields: result.fields,
          records: result.records,
          total: result.total,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.tool(
    'generateDataGovSourceUrl',
    'Build a clickable URL to view a dataset or resource on data.gov.il portal.',
    {
      orgName: z.string().describe('Organization name'),
      datasetName: z.string().describe('Dataset name'),
      resourceId: z.string().optional().describe('Resource ID'),
      title: z.string().describe('Display title'),
    },
    async ({ orgName, datasetName, resourceId, title }) => {
      const url = resourceId
        ? buildResourcePortalUrl(orgName, datasetName, resourceId)
        : buildDatasetPortalUrl(orgName, datasetName);
      return textResult({ title, url });
    },
  );

  server.tool(
    'getDatasetSchema',
    'Get the metadata schema definition for datasets.',
    {
      type: z
        .enum(['dataset', 'info'])
        .optional()
        .describe('Schema type (default: dataset)'),
    },
    async ({ type }) => {
      try {
        const result = await dataGovApi.system.schema(type ?? 'dataset');
        return textResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

function registerCbsTools(server: McpServer): void {
  server.tool(
    'browseCbsCatalog',
    'Browse CBS statistical catalog hierarchy. Level 1 = top categories (population, economy), higher levels = subcategories.',
    {
      level: z.number().int().min(1).max(5).describe('Hierarchy level (1-5)'),
      subject: z
        .string()
        .optional()
        .describe('Subject code (required for level 2+)'),
      lang: z.enum(['he', 'en']).optional().describe('Language'),
      page: z.number().int().optional(),
      pagesize: z.number().int().min(1).max(1000).optional(),
    },
    async ({ level, subject, lang, page, pagesize }) => {
      try {
        const result = await cbsApi.series.catalog({
          id: level,
          subject,
          lang,
          page,
          pagesize,
        });
        return textResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.tool(
    'browseCbsCatalogPath',
    'Browse CBS catalog by hierarchical path (e.g., "2,1,1,2,379").',
    {
      path: z.string().describe('Comma-separated path codes'),
      lang: z.enum(['he', 'en']).optional().describe('Language'),
      page: z.number().int().optional(),
      pagesize: z.number().int().min(1).max(1000).optional(),
    },
    async ({ path, lang, page, pagesize }) => {
      try {
        const result = await cbsApi.series.catalogByPath({
          id: path,
          lang,
          page,
          pagesize,
        });
        return textResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.tool(
    'getCbsSeriesData',
    'Get time series data points for a specific CBS series ID.',
    {
      seriesId: z.string().describe('Series ID'),
      startPeriod: z.string().optional().describe('Start period (mm-yyyy)'),
      endPeriod: z.string().optional().describe('End period (mm-yyyy)'),
      last: z.number().int().optional().describe('Return N most recent'),
      lang: z.enum(['he', 'en']).optional().describe('Language'),
    },
    async ({ seriesId, startPeriod, endPeriod, last, lang }) => {
      try {
        const result = await cbsApi.series.data({
          id: seriesId,
          startPeriod,
          endPeriod,
          last,
          lang,
        });
        return textResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.tool(
    'getCbsSeriesDataByPath',
    'Get time series data for all series under a catalog path.',
    {
      path: z.string().describe('Comma-separated catalog path'),
      startPeriod: z.string().optional(),
      endPeriod: z.string().optional(),
      last: z.number().int().optional(),
      lang: z.enum(['he', 'en']).optional().describe('Language'),
      page: z.number().int().optional(),
      pagesize: z.number().int().optional(),
    },
    async ({ path, startPeriod, endPeriod, last, lang, page, pagesize }) => {
      try {
        const result = await cbsApi.series.dataByPath({
          id: path,
          startPeriod,
          endPeriod,
          last,
          lang,
          page,
          pagesize,
        });
        return textResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.tool(
    'browseCbsPriceIndices',
    'Browse price index catalog. Modes: "chapters" (CPI, housing, food), "topics" (within chapter), "indices" (specific codes).',
    {
      mode: z.enum(['chapters', 'topics', 'indices']).describe('Browse mode'),
      chapterId: z
        .string()
        .optional()
        .describe('Chapter ID (required for topics mode)'),
      subjectId: z
        .string()
        .optional()
        .describe('Subject ID (required for indices mode)'),
      lang: z.enum(['he', 'en']).optional().describe('Language'),
    },
    async ({ mode, chapterId, subjectId, lang }) => {
      try {
        if (mode === 'chapters') {
          const result = await cbsApi.priceIndex.catalog({ lang });
          return textResult(result);
        } else if (mode === 'topics' && chapterId) {
          const result = await cbsApi.priceIndex.chapter(chapterId, { lang });
          return textResult(result);
        } else if (mode === 'indices' && subjectId) {
          const result = await cbsApi.priceIndex.subject(subjectId, { lang });
          return textResult(result);
        }
        return errorResult(
          new Error(
            'Invalid mode/parameter combination. topics requires chapterId, indices requires subjectId.',
          ),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.tool(
    'getCbsPriceData',
    'Get price index values over time with percentage changes.',
    {
      indexCode: z.string().describe('Price index code'),
      startPeriod: z.string().optional(),
      endPeriod: z.string().optional(),
      last: z.number().int().optional(),
      lang: z.enum(['he', 'en']).optional().describe('Language'),
    },
    async ({ indexCode, startPeriod, endPeriod, last, lang }) => {
      try {
        const result = await cbsApi.priceIndex.price({
          id: indexCode,
          startPeriod,
          endPeriod,
          last,
          lang,
        });
        return textResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.tool(
    'calculateCbsPriceIndex',
    'Calculate CPI/price index adjustment between two dates. Answer "how much would X from year Y be worth in year Z?"',
    {
      indexCode: z.string().describe('Price index code'),
      startDate: z.string().describe('Start date (yyyy-mm-dd)'),
      endDate: z.string().describe('End date (yyyy-mm-dd)'),
      sum: z.number().optional().describe('Amount to adjust (e.g., 100000)'),
      lang: z.enum(['he', 'en']).optional().describe('Language'),
    },
    async ({ indexCode, startDate, endDate, sum, lang }) => {
      try {
        const result = await cbsApi.priceIndex.calculator({
          id: indexCode,
          startDate,
          endDate,
          sum,
          lang,
        });
        return textResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.tool(
    'searchCbsLocalities',
    'Search Israeli cities, towns, and villages from CBS geographic dictionary.',
    {
      query: z.string().describe('Locality name to search'),
      matchType: z
        .enum(['BEGINS_WITH', 'CONTAINS', 'EQUALS'])
        .optional()
        .describe('Match type (default: CONTAINS)'),
      page: z.number().int().optional(),
      pagesize: z.number().int().min(1).max(250).optional(),
    },
    async ({ query, matchType, page, pagesize }) => {
      try {
        const result = await cbsApi.dictionary.search('geo', 'localities', {
          q: query,
          string_match_type: matchType,
          page,
          page_size: pagesize,
        });
        return textResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.tool(
    'generateCbsSourceUrl',
    'Build a clickable URL to CBS data source.',
    {
      sourceType: z
        .enum(['series', 'price-index', 'localities'])
        .describe('Type of CBS resource'),
      seriesId: z.string().optional().describe('Series ID (for series type)'),
      indexId: z
        .string()
        .optional()
        .describe('Index ID (for price-index type)'),
      query: z
        .string()
        .optional()
        .describe('Search query (for localities type)'),
      title: z.string().describe('Display title'),
    },
    async ({ sourceType, seriesId, indexId, query, title }) => {
      let url: string;
      switch (sourceType) {
        case 'series':
          url = `https://www.cbs.gov.il/he/Statistics/Pages/Generators/Time-Series.aspx?Series=${seriesId ?? ''}`;
          break;
        case 'price-index':
          url = `https://www.cbs.gov.il/he/Statistics/Pages/Generators/prices.aspx?Index=${indexId ?? ''}`;
          break;
        case 'localities':
          url = `https://www.cbs.gov.il/he/settlements/Pages/default.aspx?search=${query ?? ''}`;
          break;
      }
      return textResult({ title, url });
    },
  );
}

// Store active transports by session ID
const transports = new Map<
  string,
  WebStandardStreamableHTTPServerTransport
>();

async function getOrCreateTransport(
  sessionId: string | null,
): Promise<WebStandardStreamableHTTPServerTransport> {
  if (sessionId && transports.has(sessionId)) {
    return transports.get(sessionId)!;
  }

  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (id) => {
      transports.set(id, transport);
    },
    onsessionclosed: (id) => {
      transports.delete(id);
    },
  });

  transport.onclose = () => {
    if (transport.sessionId) {
      transports.delete(transport.sessionId);
    }
  };

  await server.connect(transport);
  return transport;
}

export async function GET(request: Request) {
  const sessionId = request.headers.get('mcp-session-id');
  const transport = await getOrCreateTransport(sessionId);
  return transport.handleRequest(request);
}

export async function POST(request: Request) {
  const sessionId = request.headers.get('mcp-session-id');
  const transport = await getOrCreateTransport(sessionId);
  return transport.handleRequest(request);
}

export async function DELETE(request: Request) {
  const sessionId = request.headers.get('mcp-session-id');
  if (sessionId && transports.has(sessionId)) {
    const transport = transports.get(sessionId)!;
    return transport.handleRequest(request);
  }
  return new Response('Session not found', { status: 404 });
}
