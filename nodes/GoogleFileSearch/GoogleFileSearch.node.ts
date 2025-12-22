import {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
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
		// If serialization fails, return an error object
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

export class GoogleFileSearch implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Google File Search',
		name: 'googleFileSearch',
		icon: { light: 'file:gemini.svg', dark: 'file:gemini.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description: 'Interact with Google File Search API for RAG operations',
		defaults: {
			name: 'Google File Search',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'googlePalmApi',
				required: true,
			},
		],
		usableAsTool: true,
		properties: [
			// Resource selector
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Store', value: 'store', description: 'Manage File Search stores' },
					{ name: 'Document', value: 'document', description: 'Manage documents in stores' },
					{ name: 'Query', value: 'query', description: 'Query stores with semantic search' },
				],
				default: 'store',
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
					{ name: 'List', value: 'list', action: 'List all file search stores' },
					{ name: 'Get', value: 'get', action: 'Get store details' },
					{ name: 'Delete', value: 'delete', action: 'Delete a store' },
				],
				default: 'list',
			},
			// Store fields
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
				displayName: 'Store Name',
				name: 'storeName',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['store'], operation: ['get', 'delete'] } },
				description: 'The store resource name (e.g., fileSearchStores/abc123-xyz)',
				placeholder: 'fileSearchStores/my-store-id',
			},
			{
				displayName: 'Force Delete',
				name: 'forceDelete',
				type: 'boolean',
				default: false,
				displayOptions: { show: { resource: ['store'], operation: ['delete'] } },
				description: 'Whether to force delete even if store contains documents',
			},

			// ==================== DOCUMENT OPERATIONS ====================
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['document'] } },
				options: [
					{ name: 'Upload', value: 'upload', action: 'Upload a document to a store' },
					{ name: 'Import', value: 'import', action: 'Import an existing file into a store' },
					{ name: 'List', value: 'list', action: 'List documents in a store' },
					{ name: 'Get', value: 'get', action: 'Get document details' },
					{ name: 'Delete', value: 'delete', action: 'Delete a document' },
				],
				default: 'list',
			},
			// Document fields
			{
				displayName: 'Store Name',
				name: 'storeName',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['document'] } },
				description: 'The store to operate on (e.g., fileSearchStores/abc123)',
				placeholder: 'fileSearchStores/my-store-id',
			},
			{
				displayName: 'Document Name',
				name: 'documentName',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['document'], operation: ['get', 'delete'] } },
				description: 'The document resource name',
				placeholder: 'fileSearchStores/store-id/documents/doc-id',
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
				displayName: 'File Name (from Files API)',
				name: 'fileName',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['document'], operation: ['import'] } },
				description: 'The file resource name from the Files API (e.g., files/abc123)',
				placeholder: 'files/abc123',
			},
			// Metadata for upload
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
			// Chunking options
			{
				displayName: 'Chunking Options',
				name: 'chunkingOptions',
				type: 'collection',
				placeholder: 'Add Chunking Option',
				displayOptions: { show: { resource: ['document'], operation: ['upload', 'import'] } },
				default: {},
				options: [
					{
						displayName: 'Max Tokens Per Chunk',
						name: 'maxTokensPerChunk',
						type: 'number',
						default: 256,
						description: 'Maximum tokens per chunk (default: 256)',
					},
					{
						displayName: 'Max Overlap Tokens',
						name: 'maxOverlapTokens',
						type: 'number',
						default: 20,
						description: 'Maximum overlapping tokens between chunks (default: 20)',
					},
				],
			},
			// Wait for completion
			{
				displayName: 'Wait for Completion',
				name: 'waitForCompletion',
				type: 'boolean',
				default: true,
				displayOptions: { show: { resource: ['document'], operation: ['upload', 'import'] } },
				description: 'Whether to poll until the document is fully indexed',
			},
			{
				displayName: 'Max Wait Time (seconds)',
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
						name: 'Generate Content',
						value: 'generateContent',
						action: 'Query with file search and generate content',
					},
				],
				default: 'generateContent',
			},
			// Query fields
			{
				displayName: 'Model',
				name: 'model',
				type: 'options',
				options: [
					{ name: 'Gemini 3 Flash Preview', value: 'gemini-3-flash-preview' },
					{ name: 'Gemini 2.5 Flash', value: 'gemini-2.5-flash' },
					{ name: 'Gemini 2.5 Pro', value: 'gemini-2.5-pro' },
					{ name: 'Gemini 2.0 Flash', value: 'gemini-2.0-flash' },
				],
				default: 'gemini-2.5-flash',
				displayOptions: { show: { resource: ['query'] } },
			},
			{
				displayName: 'Prompt',
				name: 'prompt',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				required: true,
				displayOptions: { show: { resource: ['query'], operation: ['generateContent'] } },
				description: 'The prompt/question to ask',
			},
			{
				displayName: 'Store Names',
				name: 'storeNames',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['query'], operation: ['generateContent'] } },
				description: 'Comma-separated list of store names to search',
				placeholder: 'fileSearchStores/store1,fileSearchStores/store2',
			},
			{
				displayName: 'Metadata Filter',
				name: 'metadataFilter',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['query'], operation: ['generateContent'] } },
				description: 'Filter query using AIP-160-like syntax. Passed as raw string to the API.',
				placeholder: 'year = 2025 AND episode_type = "rollup"',
			},
			{
				displayName: 'System Prompt',
				name: 'systemPrompt',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				displayOptions: { show: { resource: ['query'], operation: ['generateContent'] } },
				description: 'Optional system instructions for the model',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				displayOptions: { show: { resource: ['query'], operation: ['generateContent'] } },
				default: {},
				options: [
					{
						displayName: 'Temperature',
						name: 'temperature',
						type: 'number',
						default: 1.0,
						typeOptions: { minValue: 0, maxValue: 2, numberPrecision: 1 },
						description: 'Controls randomness in the response',
					},
					{
						displayName: 'Max Output Tokens',
						name: 'maxOutputTokens',
						type: 'number',
						default: 8192,
						description: 'Maximum tokens in the response',
					},
					{
						displayName: 'Include Grounding Metadata',
						name: 'includeGrounding',
						type: 'boolean',
						default: true,
						description: 'Whether to include source citations in response',
					},
				],
			},
		],
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
					throw new NodeOperationError(this.getNode(), 'API Key is required', {
						itemIndex: i,
					});
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
						result = await this.helpers.httpRequest({
							method: 'GET',
							url: `${BASE_URL}/fileSearchStores?key=${apiKey}`,
							json: true,
						});
					} else if (operation === 'get') {
						const storeName = this.getNodeParameter('storeName', i) as string;
						result = await this.helpers.httpRequest({
							method: 'GET',
							url: `${BASE_URL}/${storeName}?key=${apiKey}`,
							json: true,
						});
					} else if (operation === 'delete') {
						const storeName = this.getNodeParameter('storeName', i) as string;
						const forceDelete = this.getNodeParameter('forceDelete', i) as boolean;
						const url = forceDelete
							? `${BASE_URL}/${storeName}?force=true&key=${apiKey}`
							: `${BASE_URL}/${storeName}?key=${apiKey}`;
						result = await this.helpers.httpRequest({
							method: 'DELETE',
							url,
							json: true,
						});
					}
				}

				// ==================== DOCUMENT OPERATIONS ====================
				else if (resource === 'document') {
					// Extract store name - support both full resource name and short name
					let storeName = this.getNodeParameter('storeName', i) as string;
					if (!storeName.startsWith('fileSearchStores/')) {
						storeName = `fileSearchStores/${storeName}`;
					}

					if (operation === 'upload') {
						const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
						const documentDisplayName = this.getNodeParameter('documentDisplayName', i) as string;
						const waitForCompletion = this.getNodeParameter('waitForCompletion', i) as boolean;
						const maxWaitTime = this.getNodeParameter('maxWaitTime', i, 120) as number;

						// Get binary data
						const binaryData = this.helpers.assertBinaryData(i, binaryPropertyName);
						const buffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);

						// Build upload URL with display name if provided
						let uploadUrl = `https://generativelanguage.googleapis.com/upload/v1beta/${storeName}:uploadToFileSearchStore?key=${apiKey}`;
						if (documentDisplayName) {
							uploadUrl += `&displayName=${encodeURIComponent(documentDisplayName)}`;
						}

						// Upload the file
						const uploadResponse = (await this.helpers.httpRequest({
							method: 'POST',
							url: uploadUrl,
							headers: {
								'X-Goog-Upload-Protocol': 'raw',
								'Content-Type': binaryData.mimeType || 'application/octet-stream',
							},
							body: buffer,
							json: true,
						})) as { document?: Document };

						result = uploadResponse;

						// Poll for completion if requested
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

								// Wait 2 seconds before polling again
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

						// Poll for completion if requested
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
						result = await this.helpers.httpRequest({
							method: 'GET',
							url: `${BASE_URL}/${storeName}/documents?key=${apiKey}`,
							json: true,
						});
					} else if (operation === 'get') {
						const documentName = this.getNodeParameter('documentName', i) as string;
						result = await this.helpers.httpRequest({
							method: 'GET',
							url: `${BASE_URL}/${documentName}?key=${apiKey}`,
							json: true,
						});
					} else if (operation === 'delete') {
						const documentName = this.getNodeParameter('documentName', i) as string;
						result = await this.helpers.httpRequest({
							method: 'DELETE',
							url: `${BASE_URL}/${documentName}?key=${apiKey}`,
							json: true,
						});
					}
				}

				// ==================== QUERY OPERATIONS ====================
				else if (resource === 'query') {
					if (operation === 'generateContent') {
						const model = this.getNodeParameter('model', i) as string;
						const prompt = this.getNodeParameter('prompt', i) as string;
						const storeNamesStr = this.getNodeParameter('storeNames', i) as string;
						const metadataFilter = this.getNodeParameter('metadataFilter', i) as string;
						const systemPrompt = this.getNodeParameter('systemPrompt', i) as string;
						const options = this.getNodeParameter('options', i) as IDataObject;

						const storeNames = storeNamesStr.split(',').map((s) => s.trim());

						// Build request body
						const body: IDataObject = {
							contents: [{ parts: [{ text: prompt }] }],
							tools: [
								{
									fileSearch: {
										fileSearchStoreNames: storeNames,
										...(metadataFilter && { metadataFilter }),
									},
								},
							],
						};

						// Add system instruction if provided
						if (systemPrompt) {
							body.systemInstruction = { parts: [{ text: systemPrompt }] };
						}

						// Add generation config
						const generationConfig: IDataObject = {};
						if (options.temperature !== undefined) {
							generationConfig.temperature = options.temperature;
						}
						if (options.maxOutputTokens !== undefined) {
							generationConfig.maxOutputTokens = options.maxOutputTokens;
						}
						if (Object.keys(generationConfig).length > 0) {
							body.generationConfig = generationConfig;
						}

						result = await this.helpers.httpRequest({
							method: 'POST',
							url: `${BASE_URL}/models/${model}:generateContent?key=${apiKey}`,
							headers: { 'Content-Type': 'application/json' },
							body,
							json: true,
						});

						// Optionally extract just the text if grounding is not needed
						if (
							options.includeGrounding === false &&
							(result as any).candidates?.[0]?.content?.parts?.[0]?.text
						) {
							result = {
								text: (result as any).candidates[0].content.parts[0].text,
								model,
							};
						}
					}
				}

				returnData.push({
					json: safeSerialize(result),
					pairedItem: { item: i },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: error.message,
							success: false,
						},
						pairedItem: { item: i },
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
