/** Fields consumed from public search APIs; unused provider extensions remain outside this contract. */
interface OpenAlexLocation { pdf_url?: string; landing_page_url?: string; source?: { display_name?: string } }
export interface SearchHitData {
  title?: string;
  url?: string;
  description?: string;
  content?: string;
  text?: string;
  snippet?: string;
  link?: string;
  publication_year?: number;
  type?: string;
  cited_by_count?: number;
  doi?: string;
  best_oa_location?: OpenAlexLocation;
  primary_location?: OpenAlexLocation;
  open_access?: { oa_url?: string; is_oa?: boolean };
  locations?: OpenAlexLocation[];
}
interface DuckTopic { Text?: string; FirstURL?: string; Topics?: DuckTopic[] }
export interface SearchEnvelope {
  web?: { results?: SearchHitData[] };
  results?: SearchHitData[];
  organic_results?: SearchHitData[];
  items?: Array<{ full_name?: string; html_url?: string; description?: string; stargazers_count?: number; language?: string }>;
  Heading?: string;
  AbstractURL?: string;
  AbstractText?: string;
  RelatedTopics?: DuckTopic[];
  Results?: DuckTopic[];
}
