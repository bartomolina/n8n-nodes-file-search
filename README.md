# n8n-nodes-file-search

This is an n8n community node for **Google File Search** (Gemini API RAG).

Google File Search is a fully managed RAG (Retrieval Augmented Generation) system that allows you to store, index, and semantically search documents using the Gemini API.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

## Operations

### Store

Manage File Search stores:

- **Create** - Create a new File Search store
- **List** - List all File Search stores
- **Get** - Get details of a specific store
- **Delete** - Delete a store (with force option for non-empty stores)

### Document

Manage documents within stores:

- **Upload** - Upload a file directly to a store (supports binary data from previous nodes)
- **Import** - Import an existing file from the Files API into a store
- **List** - List all documents in a store
- **Get** - Get document details and status
- **Delete** - Delete a document from a store

Features:

- **Wait for Completion**: Polls until the document is fully indexed
- **Metadata**: Attach custom key-value pairs for filtering during queries
- **Chunking Options**: Configure max tokens per chunk and overlap

### Query

Query stores with semantic search:

- **Search** - Query one or more stores and generate a response using a Gemini model
- **Deep Research** - Run the Deep Research agent for comprehensive, multi-step analysis

#### Search Features

- **Multiple Stores**: Query across multiple stores at once
- **Metadata Filter**: Filter results using AIP-160-like syntax (e.g., `category = "reports" AND status = "published"`)
- **Structured Output**: Get responses in a specific JSON format using a JSON Schema (Gemini 3+ models)
- **System Prompt**: Provide custom system instructions
- **Model Selection**: Choose between Gemini 3 Flash/Pro, 2.5 Flash/Pro, or 2.0 Flash
- **Grounding Metadata**: Include source citations in the response

#### Deep Research Features

- **Autonomous Research**: The agent plans, searches, reads, and iterates to produce detailed reports
- **Web + File Search**: Combines public web search with your File Search stores (optional)
- **Output Formatting**: Steer the output format with custom instructions
- **Long-running Tasks**: Automatically polls for completion (typically 5-20 minutes)

## Credentials

This node requires a **Google Gemini API** credential with an API key from [Google AI Studio](https://aistudio.google.com/).

## Usage Examples

### Upload and Query Workflow

1. **Convert to File** node - Convert JSON/data to a binary file
2. **Google File Search** (Document → Upload) - Upload to your store
3. **Google File Search** (Query → Generate Content) - Query the store

### Batch Processing

The node supports processing multiple items. Use with:

- Loop nodes for batch uploads
- Conditional nodes to handle different document types
- Set node to prepare metadata before upload

## Metadata Filtering

When querying, you can filter results using metadata:

```
category = "reports"
status = "published"
year >= 2024 AND department = "engineering"
```

Note: Metadata must be attached during document upload/import to be filterable.

## Structured Output

Starting with Gemini 3 models, you can get responses in a specific JSON format by enabling **Structured Output** and providing a JSON Schema:

```json
{
	"type": "object",
	"properties": {
		"summary": { "type": "string", "description": "A brief summary of the findings" },
		"key_points": { "type": "array", "items": { "type": "string" } },
		"confidence": { "type": "number", "description": "Confidence score 0-1" }
	},
	"required": ["summary", "key_points"]
}
```

This is useful for:

- **Data extraction**: Pull specific information from documents
- **Structured classification**: Categorize content with structured labels
- **Integration workflows**: Get predictable, parseable outputs for downstream nodes

See the [Gemini Structured Output documentation](https://ai.google.dev/gemini-api/docs/structured-output) for supported schema properties.

## Deep Research

The **Deep Research** operation uses the Gemini Deep Research Agent to autonomously research complex topics. Unlike the quick Search operation, Deep Research:

- Takes **minutes** (not seconds) to complete
- Produces **detailed reports** with citations
- Can combine **web search + your documents**
- Costs approximately **$2-5 per task**

### Example Use Cases

- Market analysis and competitive landscaping
- Due diligence and literature reviews
- Comparing internal documents against public information
- Technical research and trend analysis

### Usage

1. Select **Query → Deep Research**
2. Enter your research query (be specific about what you want to learn)
3. Optionally enable **Include File Search Stores** to add your documents as sources
4. Optionally add **Output Format Instructions** to structure the report

```
Research the competitive landscape of EV batteries.

Format the output as a technical report with:
1. Executive Summary
2. Key Players (include a comparison table)
3. Technology Trends
4. Supply Chain Risks
```

### Follow-up Questions

After research completes, you can ask follow-up questions without restarting the entire research:

1. Store the `interactionId` from the first Deep Research output
2. Run Deep Research again with a follow-up question
3. Provide the previous `interactionId` in the **Previous Interaction ID** field

This lets you ask for clarification, summarization, or elaboration on the report.

**Note:** Deep Research is in preview and may take 5-20 minutes to complete. The node will poll automatically until the research is done or the max wait time is reached.

## Resources

- [Google File Search Documentation](https://ai.google.dev/gemini-api/docs/file-search)
- [Gemini Deep Research Documentation](https://ai.google.dev/gemini-api/docs/deep-research)
- [Gemini API Overview](https://ai.google.dev/gemini-api/docs)
- [AIP-160 Filtering](https://google.aip.dev/160)
- [n8n Community Nodes](https://docs.n8n.io/integrations/community-nodes/)

## License

[MIT](LICENSE.md)
