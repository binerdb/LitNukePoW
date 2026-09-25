export type AccountHolder = 'LitNuke' | 'Kim';

export interface RedditAccount {
  id: string;
  username: string;
  persona: string;
  targetSubreddits: string[];
  accountHolder: AccountHolder;
  notes?: string;
  isActive: boolean;
  createdAt: string;
  avatarUrl?: string;
  karma?: {
    total: number;
    post: number;
    comment: number;
  };
  redditCreatedUtc?: number;
}

export type ActivityType = 'post' | 'comment';

export interface ActivityItem {
  id: string;
  accountId: string;
  username: string;
  accountHolder: AccountHolder;
  persona: string;
  type: ActivityType;
  title?: string;
  body: string;
  subreddit: string;
  score: number;
  upvoteRatio?: number;
  numComments?: number;
  createdUtc: number; // Unix timestamp in seconds
  permalink: string;
  url?: string;
  parentTitle?: string;
  mediaUrl?: string;
  isTargetSubreddit: boolean;
}

export interface AccountStats {
  username: string;
  totalPosts: number;
  totalComments: number;
  totalScore: number;
  averageScore: number;
  topSubreddit: string;
  lastActiveUtc: number;
}

export interface GlobalStats {
  totalAccounts: number;
  activeAccounts: number;
  totalPosts: number;
  totalComments: number;
  totalActivities: number;
  totalUpvotes: number;
  litNukeActivities: number;
  kimActivities: number;
  uniqueSubredditsCount: number;
}

export type SortField = 'createdUtc' | 'score' | 'numComments' | 'username';
export type SortOrder = 'asc' | 'desc';

export interface FilterState {
  searchQuery: string;
  selectedUsername: string; // 'all' or specific username
  selectedHolder: string; // 'all' | 'LitNuke' | 'Kim'
  selectedType: string; // 'all' | 'post' | 'comment'
  selectedSubreddit: string; // 'all' or specific subreddit
  targetSubredditOnly: boolean;
  dateFrom: string; // 'YYYY-MM-DD' or '' for no lower bound
  dateTo: string; // 'YYYY-MM-DD' or '' for no upper bound
  sortField: SortField;
  sortOrder: SortOrder;
}

// --- GEO / AIO brand-visibility monitoring ---
// Independent checks against AI engines (do they mention the brand when
// asked relevant questions?) — unrelated to, and never fed by, Reddit
// account activity.
export type GeoEngine = 'groq' | 'groq-search' | 'gemini';

export interface GeoConfig {
  brand: string;
  engines: Record<GeoEngine, boolean>; // whether each engine's API key is configured
}

export interface GeoResult {
  id: string;
  runId: string;
  runAt: string; // ISO timestamp
  prompt: string;
  engine: GeoEngine;
  mentioned: boolean;
  snippet: string | null;
  rawAnswer: string;
  error?: string;
}
