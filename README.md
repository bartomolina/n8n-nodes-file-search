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

- **Generate Content** - Query one or more stores and generate a response using a Gemini model

Features:
- **Multiple Stores**: Query across multiple stores at once
- **Metadata Filter**: Filter results using AIP-160-like syntax (e.g., `year = 2025 AND type = "rollup"`)
- **System Prompt**: Provide custom system instructions
- **Model Selection**: Choose between Gemini 2.5 Flash, 2.5 Pro, or 2.0 Flash
- **Grounding Metadata**: Include source citations in the response

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
year = 2025
episode_type = "rollup"
year >= 2024 AND sentiment = "bullish"
```

Note: Metadata must be attached during document upload/import to be filterable.

## Resources

- [Google File Search Documentation](https://ai.google.dev/gemini-api/docs/file-search)
- [Gemini API Overview](https://ai.google.dev/gemini-api/docs)
- [AIP-160 Filtering](https://google.aip.dev/160)
- [n8n Community Nodes](https://docs.n8n.io/integrations/community-nodes/)

## License

[MIT](LICENSE.md)
