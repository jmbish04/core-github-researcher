/**
 * Vectorize integration for indexing and searching GitHub repositories
 */

export interface RepoVector {
  id: string;
  values: number[];
  metadata: {
    fullName: string;
    description: string;
    url: string;
    stars: number;
    language?: string;
    topics?: string[];
    taskId: string;
  };
}

/**
 * Generate embeddings for a repository using text content
 * In production, this would use an embedding model (e.g., OpenAI embeddings)
 * For now, we use a simple deterministic hash-based embedding
 * 
 * TODO: Integrate with OpenAI Embeddings API using the openaiKey parameter
 */
export async function generateRepoEmbedding(
  repoData: {
    fullName: string;
    description: string;
    topics?: string[];
    language?: string;
  },
  _openaiKey?: string // Unused for now, will be used when implementing real embeddings
): Promise<number[]> {
  // For now, create a simple hash-based embedding
  // In production, replace with actual embedding API call
  const text = [
    repoData.fullName,
    repoData.description,
    repoData.language,
    ...(repoData.topics || []),
  ].filter(Boolean).join(' ');
  
  // Simple deterministic embedding (replace with real embeddings in production)
  const embedding = new Array(1536).fill(0); // Match OpenAI embedding dimensions
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i);
    embedding[i % 1536] = (embedding[i % 1536] + charCode) / 2;
  }
  
  // Normalize the vector
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  return embedding.map(val => val / (magnitude || 1));
}

/**
 * Index a repository in Vectorize
 */
export async function indexRepository(
  vectorize: VectorizeIndex,
  repoData: {
    id: string;
    fullName: string;
    description: string;
    url: string;
    stars: number;
    language?: string;
    topics?: string[];
    taskId: string;
  },
  openaiKey?: string
): Promise<string> {
  const embedding = await generateRepoEmbedding(repoData, openaiKey);
  
  const vector: RepoVector = {
    id: repoData.id,
    values: embedding,
    metadata: {
      fullName: repoData.fullName,
      description: repoData.description,
      url: repoData.url,
      stars: repoData.stars,
      language: repoData.language,
      topics: repoData.topics,
      taskId: repoData.taskId,
    },
  };
  
  await vectorize.upsert([vector]);
  return repoData.id;
}

/**
 * Search for similar repositories using vector similarity
 */
export async function searchSimilarRepositories(
  vectorize: VectorizeIndex,
  query: string,
  options: {
    topK?: number;
    filter?: Record<string, string | number>;
    openaiKey?: string;
  } = {}
): Promise<Array<{
  id: string;
  score: number;
  metadata: RepoVector['metadata'];
}>> {
  const { topK = 10, filter, openaiKey } = options;
  
  // Generate embedding for the query
  const queryEmbedding = await generateRepoEmbedding(
    { fullName: query, description: query },
    openaiKey
  );
  
  const results = await vectorize.query(queryEmbedding, {
    topK,
    filter,
    returnMetadata: true,
  });
  
  return results.matches.map(match => ({
    id: match.id,
    score: match.score,
    metadata: match.metadata as RepoVector['metadata'],
  }));
}

/**
 * Delete a repository from Vectorize
 */
export async function deleteRepository(
  vectorize: VectorizeIndex,
  repoId: string
): Promise<void> {
  await vectorize.deleteByIds([repoId]);
}

/**
 * Query repositories by metadata filters
 * 
 * Note: This uses a zero vector for metadata-only filtering, which is a workaround
 * since Vectorize requires a vector query. In production, consider using D1 queries
 * for pure metadata filtering, and use Vectorize only for similarity searches.
 */
export async function queryRepositoriesByMetadata(
  vectorize: VectorizeIndex,
  filter: Record<string, string | number>,
  limit: number = 100
): Promise<Array<{
  id: string;
  metadata: RepoVector['metadata'];
}>> {
  // Since Vectorize requires a vector query, we'll use a zero vector for metadata-only filtering
  // This is inefficient but allows querying by metadata. Consider using D1 for metadata-only queries.
  const zeroVector = new Array(1536).fill(0);
  
  const results = await vectorize.query(zeroVector, {
    topK: limit,
    filter,
    returnMetadata: true,
  });
  
  return results.matches.map(match => ({
    id: match.id,
    metadata: match.metadata as RepoVector['metadata'],
  }));
}
