import {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	NodeConnectionTypes,
	NodeOperationError,
} from 'n8n-workflow';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

// Helper function for async sleep
const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

// Helper function to safely serialize response data (removes circular references)
const safeSerialize = <T>(data: T): T => {
	try {
		return JSON.parse(JSON.stringify(data));
	} catch {
		return { error: 'Failed to serialize response data' } as unknown as T;
	}
};

interface Document {
	name: string;
	state: string;
	createTime: string;
	updateTime: string;
	sizeBytes?: string;
	mimeType?: string;
	displayName?: string;
}

interface Store {
	name: string;
	displayName?: string;
	createTime?: string;
	updateTime?: string;
}

interface GeminiResponse {
	candidates?: Array<{
		content?: {
			parts?: Array<{ text?: string }>;
		};
	}>;
}

interface InteractionResponse {
	id?: string;
	status?: string;
	error?: string;
	outputs?: Array<{
		text?: string;
		[key: string]: unknown;
	}>;
	[key: string]: unknown;
}

export class GoogleFileSearch implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Google File Search',
		name: 'googleFileSearch',
		icon: { light: 'file:gemini.svg', dark: 'file:gemini.svg' },
		group: ['input'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description: 'Interact with Google File Search API for RAG operations',
		defaults: {
			name: 'Google File Search',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'googlePalmApi',
				required: true,
			},
		],
		usableAsTool: true,
		properties: [
			// ==================== RESOURCE SELECTOR ====================
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Document', value: 'document', description: 'Manage documents in stores' },
					{ name: 'Query', value: 'query', description: 'Query stores with semantic search' },
					{ name: 'Store', value: 'store', description: 'Manage File Search stores' },
				],
				default: 'query',
			},

			// ==================== STORE OPERATIONS ====================
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['store'] } },
				options: [
					{ name: 'Create', value: 'create', action: 'Create a file search store' },
					{ name: 'Delete', value: 'delete', action: 'Delete a store' },
					{ name: 'Get', value: 'get', action: 'Get store details' },
					{ name: 'List', value: 'list', action: 'List all file search stores' },
				],
				default: 'list',
			},
			{
				displayName: 'Display Name',
				name: 'displayName',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['store'], operation: ['create'] } },
				description: 'A user-friendly name for the store',
			},
			{
				displayName: 'Store Name or ID',
				name: 'storeId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getStores',
				},
				default: '',
				required: true,
				displayOptions: { show: { resource: ['store'], operation: ['get', 'delete'] } },
				description:
					'The store to operate on. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Force Delete',
				name: 'forceDelete',
				type: 'boolean',
				default: false,
				displayOptions: { show: { resource: ['store'], operation: ['delete'] } },
				description: 'Whether to force delete even if store contains documents',
			},
			{
				displayName: 'Pagination Cursor',
				name: 'paginationCursorStores',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['store'], operation: ['list'] } },
				description:
					'Cursor to fetch the next page of results. Use the nextPageToken from a previous response.',
			},

			// ==================== DOCUMENT OPERATIONS ====================
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['document'] } },
				options: [
					{ name: 'Delete', value: 'delete', action: 'Delete a document' },
					{ name: 'Get', value: 'get', action: 'Get document details' },
					{ name: 'Import', value: 'import', action: 'Import an existing file into a store' },
					{ name: 'List', value: 'list', action: 'List documents in a store' },
					{ name: 'Upload', value: 'upload', action: 'Upload a document to a store' },
				],
				default: 'list',
			},
			{
				displayName: 'Store Name or ID',
				name: 'documentStoreId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getStores',
				},
				default: '',
				required: true,
				displayOptions: { show: { resource: ['document'], operation: ['list', 'upload', 'import'] } },
				description:
					'The store to operate on. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Document Name',
				name: 'documentName',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['document'], operation: ['get', 'delete'] } },
				description: 'The document resource name',
				placeholder: 'fileSearchStores/store-ID/documents/doc-ID',
			},
			{
				displayName: 'Force Delete',
				name: 'forceDeleteDocument',
				type: 'boolean',
				default: true,
				displayOptions: { show: { resource: ['document'], operation: ['delete'] } },
				description: 'Whether to force delete even if document contains content',
			},
			{
				displayName: 'Pagination Cursor',
				name: 'paginationCursorDocuments',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['document'], operation: ['list'] } },
				description:
					'Cursor to fetch the next page of results. Use the nextPageToken from a previous response.',
			},
			{
				displayName: 'Input Data Field',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				displayOptions: { show: { resource: ['document'], operation: ['upload'] } },
				description: 'Name of the binary property containing the file to upload',
			},
			{
				displayName: 'Display Name',
				name: 'documentDisplayName',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['document'], operation: ['upload'] } },
				description: 'Display name for the document (used in citations)',
			},
			{
				displayName: 'File Name (From Files API)',
				name: 'fileName',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['document'], operation: ['import'] } },
				description: 'The file resource name from the Files API (e.g., files/abc123)',
				placeholder: 'files/abc123',
			},
			{
				displayName: 'Metadata',
				name: 'metadata',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				displayOptions: { show: { resource: ['document'], operation: ['upload', 'import'] } },
				default: {},
				options: [
					{
						name: 'metadataValues',
						displayName: 'Metadata',
						values: [
							{ displayName: 'Key', name: 'key', type: 'string', default: '' },
							{ displayName: 'Value', name: 'value', type: 'string', default: '' },
						],
					},
				],
				description: 'Custom metadata key-value pairs for filtering during queries',
			},
			{
				displayName: 'Wait for Completion',
				name: 'waitForCompletion',
				type: 'boolean',
				default: true,
				displayOptions: { show: { resource: ['document'], operation: ['upload', 'import'] } },
				description: 'Whether to poll until the document is fully indexed',
			},
			{
				displayName: 'Max Wait Time (Seconds)',
				name: 'maxWaitTime',
				type: 'number',
				default: 120,
				displayOptions: {
					show: {
						resource: ['document'],
						operation: ['upload', 'import'],
						waitForCompletion: [true],
					},
				},
				description: 'Maximum time to wait for document processing',
			},

			// ==================== QUERY OPERATIONS ====================
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['query'] } },
				options: [
					{
						name: 'Deep Research',
						value: 'deepResearch',
						action: 'Run deep research agent for comprehensive analysis',
					},
					{
						name: 'Search',
						value: 'search',
						action: 'Search documents and generate a response',
					},
				],
				default: 'search',
			},
			// ==================== DEEP RESEARCH PARAMETERS ====================
			{
				displayName: 'Research Query',
				name: 'researchQuery',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				default: '',
				required: true,
				displayOptions: { show: { resource: ['query'], operation: ['deepResearch'] } },
				description: 'The research task for the Deep Research agent',
				placeholder:
					'e.g., Research the competitive landscape of EV batteries and provide a detailed analysis',
			},
			{
				displayName: 'Include File Search Stores',
				name: 'includeFileSearch',
				type: 'boolean',
				default: false,
				displayOptions: { show: { resource: ['query'], operation: ['deepResearch'] } },
				description:
					'Whether to include your File Search stores as data sources (experimental). By default, the agent searches the public web.',
			},
			{
				displayName: 'Store Names or IDs',
				name: 'deepResearchStoreNames',
				type: 'multiOptions',
				typeOptions: {
					loadOptionsMethod: 'getStores',
				},
				default: [],
				displayOptions: {
					show: { resource: ['query'], operation: ['deepResearch'], includeFileSearch: [true] },
				},
				description:
					'File Search stores to include in the research. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Output Format Instructions',
				name: 'outputFormat',
				type: 'string',
				typeOptions: {
					rows: 3,
				},
				default: '',
				displayOptions: { show: { resource: ['query'], operation: ['deepResearch'] } },
				description:
					'Optional formatting instructions for the output (e.g., "Format as a technical report with Executive Summary, Key Findings, and Recommendations sections")',
				placeholder: 'e.g., Format the output as a technical report with sections...',
			},
			{
				displayName: 'Max Wait Time (Minutes)',
				name: 'deepResearchMaxWait',
				type: 'number',
				default: 30,
				typeOptions: { minValue: 1, maxValue: 60 },
				displayOptions: { show: { resource: ['query'], operation: ['deepResearch'] } },
				description:
					'Maximum time to wait for research completion (1-60 minutes). Deep Research tasks typically take 5-20 minutes.',
			},
			{
				displayName: 'Previous Interaction ID',
				name: 'previousInteractionId',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['query'], operation: ['deepResearch'] } },
				description:
					'Continue a previous research conversation. Provide the interaction ID from a completed Deep Research to ask follow-up questions.',
				placeholder: 'e.g., interactions/abc123',
			},

			// ==================== SEARCH PARAMETERS ====================
			{
				displayName: 'Model',
				name: 'model',
				type: 'options',
				displayOptions: { show: { resource: ['query'], operation: ['search'] } },
				options: [
					{ name: 'Gemini 2.0 Flash', value: 'gemini-2.0-flash' },
					{ name: 'Gemini 2.5 Flash', value: 'gemini-2.5-flash' },
					{ name: 'Gemini 2.5 Flash Lite', value: 'gemini-2.5-flash-lite' },
					{ name: 'Gemini 2.5 Pro', value: 'gemini-2.5-pro' },
					{ name: 'Gemini 3 Flash Preview', value: 'gemini-3-flash-preview' },
					{ name: 'Gemini 3 Pro Preview', value: 'gemini-3-pro-preview' },
				],
				default: 'gemini-3-flash-preview',
				description: 'The Gemini model to use for generation',
			},
			{
				displayName: 'Store Names or IDs',
				name: 'storeNames',
				type: 'multiOptions',
				typeOptions: {
					loadOptionsMethod: 'getStores',
				},
				default: [],
				required: true,
				displayOptions: { show: { resource: ['query'], operation: ['search'] } },
				description:
					'The stores to search. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Query',
				name: 'query',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['query'], operation: ['search'] } },
				description: 'The search query to execute against the selected stores',
				placeholder: 'e.g., What are the main findings in the report?',
			},
			{
				displayName: 'Metadata Filter',
				name: 'metadataFilter',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['query'], operation: ['search'] } },
				description: 'Filter query using AIP-160-like syntax',
				placeholder: 'e.g., category = "reports" AND status = "published"',
			},
			{
				displayName: 'Structured Output',
				name: 'structuredOutput',
				type: 'boolean',
				default: false,
				displayOptions: { show: { resource: ['query'], operation: ['search'] } },
				description:
					'Whether to return a structured JSON response matching a schema (requires Gemini 3+ models)',
			},
			{
				displayName: 'JSON Schema',
				name: 'jsonSchema',
				type: 'json',
				default:
					'{\n  "type": "object",\n  "properties": {\n    "answer": { "type": "string", "description": "The answer to the query" },\n    "sources": { "type": "array", "items": { "type": "string" }, "description": "List of source references" }\n  },\n  "required": ["answer"]\n}',
				displayOptions: {
					show: { resource: ['query'], operation: ['search'], structuredOutput: [true] },
				},
				description:
					'JSON Schema that defines the structure of the response. See <a href="https://ai.google.dev/gemini-api/docs/structured-output">Gemini Structured Output docs</a> for supported schema properties.',
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['query'], operation: ['search'] } },
				options: [
					{
						displayName: 'Include Grounding Metadata',
						name: 'includeGrounding',
						type: 'boolean',
						default: true,
						description: 'Whether to include source citations in response',
					},
					{
						displayName: 'Max Output Tokens',
						name: 'maxOutputTokens',
						type: 'number',
						default: '',
						description: 'Maximum tokens in the response. Leave empty to use model default.',
					},
					{
						displayName: 'System Prompt',
						name: 'systemPrompt',
						type: 'string',
						default: '',
						description: 'Optional system instructions for the model',
					},
					{
						displayName: 'Temperature',
						name: 'temperature',
						type: 'number',
						default: 1.0,
						typeOptions: { minValue: 0, maxValue: 2 },
						description: 'Controls randomness in the response (0-2)',
					},
				],
			},
		],
	};

	methods = {
		loadOptions: {
			async getStores(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const credentials = await this.getCredentials('googlePalmApi');
				const apiKey = credentials.apiKey as string;

				try {
					// Fetch first page of stores (typically 100) - enough for dropdown selection
					// Users with more stores can use expressions to specify store names directly
					const response = (await this.helpers.httpRequest({
						method: 'GET',
						url: `https://generativelanguage.googleapis.com/v1beta/fileSearchStores?key=${apiKey}`,
						json: true,
					})) as { fileSearchStores?: Store[] };

					const stores = response.fileSearchStores || [];
					return stores.map((store) => ({
						name: store.displayName || store.name.replace('fileSearchStores/', ''),
						value: store.name,
					}));
				} catch {
					// Return empty array if API fails (e.g., no stores yet)
					return [];
				}
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const credentials = await this.getCredentials('googlePalmApi', i);
				const apiKey = credentials.apiKey as string;

				if (!apiKey) {
					throw new NodeOperationError(this.getNode(), 'API Key is required', { itemIndex: i });
				}

				let result: IDataObject = {};

				// ==================== STORE OPERATIONS ====================
				if (resource === 'store') {
					if (operation === 'create') {
						const displayName = this.getNodeParameter('displayName', i) as string;
						result = await this.helpers.httpRequest({
							method: 'POST',
							url: `${BASE_URL}/fileSearchStores?key=${apiKey}`,
							headers: { 'Content-Type': 'application/json' },
							body: { displayName },
							json: true,
						});
					} else if (operation === 'list') {
						const paginationCursor = this.getNodeParameter(
							'paginationCursorStores',
							i,
							'',
						) as string;

						const url = paginationCursor
							? `${BASE_URL}/fileSearchStores?key=${apiKey}&pageToken=${paginationCursor}`
							: `${BASE_URL}/fileSearchStores?key=${apiKey}`;

						const response = (await this.helpers.httpRequest({
							method: 'GET',
							url,
							json: true,
						})) as { fileSearchStores?: IDataObject[]; nextPageToken?: string };

						result = {
							items: response.fileSearchStores || [],
							nextPageToken: response.nextPageToken || null,
						};
					} else if (operation === 'get') {
						const storeId = this.getNodeParameter('storeId', i) as string;
						result = await this.helpers.httpRequest({
							method: 'GET',
							url: `${BASE_URL}/${storeId}?key=${apiKey}`,
							json: true,
						});
					} else if (operation === 'delete') {
						const storeId = this.getNodeParameter('storeId', i) as string;
						const forceDelete = this.getNodeParameter('forceDelete', i) as boolean;
						const url = forceDelete
							? `${BASE_URL}/${storeId}?force=true&key=${apiKey}`
							: `${BASE_URL}/${storeId}?key=${apiKey}`;
						result = await this.helpers.httpRequest({ method: 'DELETE', url, json: true });
					}
				}

				// ==================== DOCUMENT OPERATIONS ====================
				else if (resource === 'document') {
					// Get store name only for operations that need it (list, upload, import)
					let storeName = '';
					if (['list', 'upload', 'import'].includes(operation)) {
						storeName = this.getNodeParameter('documentStoreId', i) as string;
						if (!storeName.startsWith('fileSearchStores/')) {
							storeName = `fileSearchStores/${storeName}`;
						}
					}

					if (operation === 'upload') {
						const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
						const documentDisplayName = this.getNodeParameter('documentDisplayName', i) as string;
						const waitForCompletion = this.getNodeParameter('waitForCompletion', i) as boolean;
						const maxWaitTime = this.getNodeParameter('maxWaitTime', i, 120) as number;

						const metadataParam = this.getNodeParameter('metadata', i) as {
							metadataValues?: Array<{ key: string; value: string }>;
						};
						const metadataValues = metadataParam.metadataValues || [];

						const binaryData = this.helpers.assertBinaryData(i, binaryPropertyName);
						const buffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);

						const uploadUrl = `https://generativelanguage.googleapis.com/upload/v1beta/${storeName}:uploadToFileSearchStore?key=${apiKey}`;

						let uploadResponse: { document?: Document };

						if (metadataValues.length > 0 || documentDisplayName) {
							const customMetadata: Array<{
								key: string;
								stringValue?: string;
								numericValue?: number;
							}> = [];

							for (const { key, value } of metadataValues) {
								if (key && value !== undefined && value !== null) {
									const strValue = String(value).trim();
									const numValue = Number(strValue);
									const isPureNumber =
										strValue !== '' &&
										!isNaN(numValue) &&
										isFinite(numValue) &&
										String(numValue) === strValue;

									if (isPureNumber) {
										customMetadata.push({ key, numericValue: numValue });
									} else {
										customMetadata.push({ key, stringValue: strValue });
									}
								}
							}

							const metadataObj: {
								displayName?: string;
								customMetadata?: typeof customMetadata;
							} = {};

							if (documentDisplayName) metadataObj.displayName = documentDisplayName;
							if (customMetadata.length > 0) metadataObj.customMetadata = customMetadata;

							const boundary = '----n8nBoundary' + Date.now().toString(16);
							const mimeType = binaryData.mimeType || 'application/octet-stream';

							const metadataPart = Buffer.from(
								`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadataObj)}\r\n`,
							);
							const filePart = Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`);
							const endBoundary = Buffer.from(`\r\n--${boundary}--`);

							const multipartBody = Buffer.concat([metadataPart, filePart, buffer, endBoundary]);

							uploadResponse = (await this.helpers.httpRequest({
								method: 'POST',
								url: uploadUrl,
								headers: {
									'X-Goog-Upload-Protocol': 'multipart',
									'Content-Type': `multipart/related; boundary=${boundary}`,
								},
								body: multipartBody,
								json: true,
							})) as { document?: Document };
						} else {
							uploadResponse = (await this.helpers.httpRequest({
								method: 'POST',
								url: uploadUrl,
								headers: {
									'X-Goog-Upload-Protocol': 'raw',
									'Content-Type': binaryData.mimeType || 'application/octet-stream',
								},
								body: buffer,
								json: true,
							})) as { document?: Document };
						}

						result = uploadResponse;

						if (waitForCompletion && uploadResponse.document?.name) {
							const docName = uploadResponse.document.name;
							const startTime = Date.now();
							const maxWaitMs = maxWaitTime * 1000;

							while (Date.now() - startTime < maxWaitMs) {
								const docStatus = (await this.helpers.httpRequest({
									method: 'GET',
									url: `${BASE_URL}/${docName}?key=${apiKey}`,
									json: true,
								})) as Document;

								if (docStatus.state === 'STATE_ACTIVE') {
									result = { ...uploadResponse, document: docStatus, status: 'completed' };
									break;
								} else if (docStatus.state === 'STATE_FAILED') {
									throw new NodeOperationError(this.getNode(), 'Document processing failed', {
										itemIndex: i,
									});
								}

								await sleep(2000);
							}

							if ((result as IDataObject).status !== 'completed') {
								result = {
									...uploadResponse,
									status: 'timeout',
									message: 'Document still processing',
								};
							}
						}
					} else if (operation === 'import') {
						const fileName = this.getNodeParameter('fileName', i) as string;
						const waitForCompletion = this.getNodeParameter('waitForCompletion', i) as boolean;
						const maxWaitTime = this.getNodeParameter('maxWaitTime', i, 120) as number;

						const importResponse = (await this.helpers.httpRequest({
							method: 'POST',
							url: `${BASE_URL}/${storeName}:importFile?key=${apiKey}`,
							headers: { 'Content-Type': 'application/json' },
							body: { fileName },
							json: true,
						})) as { document?: Document };

						result = importResponse;

						if (waitForCompletion && importResponse.document?.name) {
							const docName = importResponse.document.name;
							const startTime = Date.now();
							const maxWaitMs = maxWaitTime * 1000;

							while (Date.now() - startTime < maxWaitMs) {
								const docStatus = (await this.helpers.httpRequest({
									method: 'GET',
									url: `${BASE_URL}/${docName}?key=${apiKey}`,
									json: true,
								})) as Document;

								if (docStatus.state === 'STATE_ACTIVE') {
									result = { ...importResponse, document: docStatus, status: 'completed' };
									break;
								} else if (docStatus.state === 'STATE_FAILED') {
									throw new NodeOperationError(this.getNode(), 'Document import failed', {
										itemIndex: i,
									});
								}

								await sleep(2000);
							}

							if ((result as IDataObject).status !== 'completed') {
								result = {
									...importResponse,
									status: 'timeout',
									message: 'Document still processing',
								};
							}
						}
					} else if (operation === 'list') {
						const paginationCursor = this.getNodeParameter(
							'paginationCursorDocuments',
							i,
							'',
						) as string;

						const url = paginationCursor
							? `${BASE_URL}/${storeName}/documents?key=${apiKey}&pageToken=${paginationCursor}`
							: `${BASE_URL}/${storeName}/documents?key=${apiKey}`;

						const response = (await this.helpers.httpRequest({
							method: 'GET',
							url,
							json: true,
						})) as { documents?: Document[]; nextPageToken?: string };

						result = {
							items: response.documents || [],
							nextPageToken: response.nextPageToken || null,
						};
					} else if (operation === 'get') {
						const documentName = this.getNodeParameter('documentName', i) as string;
						result = await this.helpers.httpRequest({
							method: 'GET',
							url: `${BASE_URL}/${documentName}?key=${apiKey}`,
							json: true,
						});
					} else if (operation === 'delete') {
						const documentName = this.getNodeParameter('documentName', i) as string;
						const forceDelete = this.getNodeParameter('forceDeleteDocument', i) as boolean;
						const url = forceDelete
							? `${BASE_URL}/${documentName}?force=true&key=${apiKey}`
							: `${BASE_URL}/${documentName}?key=${apiKey}`;
						await this.helpers.httpRequest({ method: 'DELETE', url, json: true });
						result = { success: true, deleted: documentName };
					}
				}

				// ==================== QUERY OPERATIONS ====================
				else if (resource === 'query') {
					if (operation === 'deepResearch') {
						// Deep Research uses the Interactions API
						let researchQuery = this.getNodeParameter('researchQuery', i, '') as string;

						// Fallback: check if query comes from input item (when used as AI Agent tool)
						if (!researchQuery && items[i].json) {
							researchQuery =
								(items[i].json.query as string) ||
								(items[i].json.prompt as string) ||
								(items[i].json.chatInput as string) ||
								(items[i].json.input as string) ||
								'';
						}

						if (!researchQuery) {
							throw new NodeOperationError(this.getNode(), 'Research query is required', {
								itemIndex: i,
							});
						}

						const includeFileSearch = this.getNodeParameter(
							'includeFileSearch',
							i,
							false,
						) as boolean;
						const outputFormat = this.getNodeParameter('outputFormat', i, '') as string;
						const maxWaitMinutes = this.getNodeParameter('deepResearchMaxWait', i, 30) as number;
						const previousInteractionId = this.getNodeParameter(
							'previousInteractionId',
							i,
							'',
						) as string;

						// Build the input with optional format instructions
						let input = researchQuery;
						if (outputFormat) {
							input = `${researchQuery}\n\n${outputFormat}`;
						}

						// Build tools array (file_search is optional)
						const tools: Array<{ type: string; file_search_store_names?: string[] }> = [];
						if (includeFileSearch) {
							const storeNames = this.getNodeParameter('deepResearchStoreNames', i, []) as string[];
							if (storeNames.length > 0) {
								tools.push({
									type: 'file_search',
									file_search_store_names: storeNames,
								});
							}
						}

						// Create the interaction (starts research in background)
						const interactionBody: IDataObject = {
							input,
							agent: 'deep-research-pro-preview-12-2025',
							background: true,
							store: true,
						};

						if (tools.length > 0) {
							interactionBody.tools = tools;
						}

						// Add previous interaction ID for follow-up questions
						if (previousInteractionId) {
							interactionBody.previous_interaction_id = previousInteractionId;
						}

						const interaction = (await this.helpers.httpRequest({
							method: 'POST',
							url: `${BASE_URL}/interactions?key=${apiKey}`,
							headers: { 'Content-Type': 'application/json' },
							body: interactionBody,
							json: true,
						})) as InteractionResponse;

						if (!interaction.id) {
							throw new NodeOperationError(
								this.getNode(),
								'Failed to start Deep Research: No interaction ID returned',
								{ itemIndex: i },
							);
						}

						// Poll for completion
						const startTime = Date.now();
						const maxWaitMs = maxWaitMinutes * 60 * 1000;
						const pollInterval = 10000; // 10 seconds

						let finalResult: InteractionResponse = interaction;

						while (Date.now() - startTime < maxWaitMs) {
							const statusResponse = (await this.helpers.httpRequest({
								method: 'GET',
								url: `${BASE_URL}/interactions/${interaction.id}?key=${apiKey}`,
								json: true,
							})) as InteractionResponse;

							if (statusResponse.status === 'completed') {
								finalResult = statusResponse;
								break;
							} else if (statusResponse.status === 'failed') {
								throw new NodeOperationError(
									this.getNode(),
									`Deep Research failed: ${statusResponse.error || 'Unknown error'}`,
									{ itemIndex: i },
								);
							}

							// Still in progress, wait before polling again
							await sleep(pollInterval);
						}

						// Check if we timed out
						if (finalResult.status !== 'completed') {
							result = {
								interactionId: interaction.id,
								status: 'timeout',
								message: `Research still in progress after ${maxWaitMinutes} minutes. You can check the status later using the interaction ID.`,
								elapsedMinutes: Math.round((Date.now() - startTime) / 60000),
							};
						} else {
							// Extract the final report text
							const outputs = finalResult.outputs || [];
							const reportText = outputs.length > 0 ? outputs[outputs.length - 1].text : '';

							result = {
								interactionId: interaction.id,
								status: 'completed',
								report: reportText,
								outputs: outputs,
							};
						}
					} else if (operation === 'search') {
						let query = this.getNodeParameter('query', i, '') as string;

						// Fallback: check if query comes from input item (when used as AI Agent tool)
						if (!query && items[i].json) {
							query =
								(items[i].json.query as string) ||
								(items[i].json.prompt as string) ||
								(items[i].json.chatInput as string) ||
								(items[i].json.input as string) ||
								'';
						}

						if (!query) {
							throw new NodeOperationError(this.getNode(), 'Query is required', { itemIndex: i });
						}

						const storeNames = this.getNodeParameter('storeNames', i) as string[];
						const model = this.getNodeParameter('model', i) as string;
						const metadataFilter = this.getNodeParameter('metadataFilter', i, '') as string;
						const structuredOutput = this.getNodeParameter('structuredOutput', i, false) as boolean;
						const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;
						const temperature = (additionalFields.temperature as number) ?? 1.0;
						const maxOutputTokens = additionalFields.maxOutputTokens as number | undefined;
						const systemPrompt = (additionalFields.systemPrompt as string) || '';
						const includeGrounding = (additionalFields.includeGrounding as boolean) ?? true;

						const generationConfig: IDataObject = { temperature };
						if (maxOutputTokens) {
							generationConfig.maxOutputTokens = maxOutputTokens;
						}

						// Add structured output configuration (Gemini 3+ feature)
						if (structuredOutput) {
							const jsonSchemaString = this.getNodeParameter('jsonSchema', i, '{}') as string;
							try {
								const jsonSchema = JSON.parse(jsonSchemaString);
								generationConfig.responseMimeType = 'application/json';
								generationConfig.responseSchema = jsonSchema;
							} catch {
								throw new NodeOperationError(
									this.getNode(),
									'Invalid JSON Schema: Please provide a valid JSON object',
									{ itemIndex: i },
								);
							}
						}

						const body: IDataObject = {
							contents: [{ parts: [{ text: query }] }],
							tools: [
								{
									fileSearch: {
										fileSearchStoreNames: storeNames,
										...(metadataFilter && { metadataFilter }),
									},
								},
							],
							generationConfig,
						};

						if (systemPrompt) {
							body.systemInstruction = { parts: [{ text: systemPrompt }] };
						}

						result = await this.helpers.httpRequest({
							method: 'POST',
							url: `${BASE_URL}/models/${model}:generateContent?key=${apiKey}`,
							headers: { 'Content-Type': 'application/json' },
							body,
							json: true,
						});

						// Extract and format the response
						const geminiResult = result as GeminiResponse;
						const responseText = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text;

						if (structuredOutput && responseText) {
							// Parse the structured JSON response
							try {
								const parsedResponse = JSON.parse(responseText);
								result = includeGrounding
									? { data: parsedResponse, model, groundingMetadata: geminiResult }
									: { data: parsedResponse, model };
							} catch {
								// If parsing fails, return the raw text
								result = includeGrounding
									? { text: responseText, model, parseError: true, groundingMetadata: geminiResult }
									: { text: responseText, model, parseError: true };
							}
						} else if (!includeGrounding && responseText) {
							result = {
								text: responseText,
								model,
							};
						}
					}
				}

				returnData.push({ json: safeSerialize(result), pairedItem: { item: i } });
			} catch (error) {
				let errorMessage = error.message;
				let errorDetails: IDataObject = {};

				if (error.response?.body) {
					errorDetails = error.response.body as IDataObject;
					if (typeof errorDetails === 'object' && errorDetails.error) {
						const apiError = errorDetails.error as IDataObject;
						errorMessage = (apiError.message as string) || errorMessage;
					}
				}

				if (this.continueOnFail()) {
					returnData.push({
						json: { error: errorMessage, errorDetails, success: false },
						pairedItem: { item: i },
					});
					continue;
				}

				throw new NodeOperationError(this.getNode(), errorMessage, {
					itemIndex: i,
					description: JSON.stringify(errorDetails),
				});
			}
		}

		return [returnData];
	}
}
