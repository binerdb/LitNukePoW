import { RedditAccount, ActivityItem } from '../types';
import { INITIAL_ACCOUNTS, INITIAL_ACTIVITIES } from '../data/initialAccounts';
import { isSubredditMatch, normalizeSubreddit } from '../utils/formatters';

// Data lives on the server (see /api/data/*), not in localStorage — that way
// the same accounts/activities show up regardless of which browser or
// device you're using, as long as you're logged into the same server.

export async function loadSavedAccounts(): Promise<RedditAccount[]> {
  try {
    const res = await fetch('/api/data/accounts', { credentials: 'include' });
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    const data = await res.json();
    if (data.success && Array.isArray(data.accounts)) {
      return data.accounts;
    }
  } catch (e) {
    console.error('Failed to load accounts from server:', e);
  }
  return INITIAL_ACCOUNTS;
}

export async function saveAccountsToStorage(accounts: RedditAccount[]): Promise<boolean> {
  try {
    const res = await fetch('/api/data/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(accounts),
    });
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    return true;
  } catch (e) {
    console.error('Failed to save accounts to server:', e);
    return false;
  }
}

export async function loadSavedActivities(): Promise<ActivityItem[]> {
  try {
    const res = await fetch('/api/data/activities', { credentials: 'include' });
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    const data = await res.json();
    if (data.success && Array.isArray(data.activities)) {
      return data.activities;
    }
  } catch (e) {
    console.error('Failed to load activities from server:', e);
  }
  return INITIAL_ACTIVITIES;
}

export async function saveActivitiesToStorage(activities: ActivityItem[]): Promise<boolean> {
  try {
    const res = await fetch('/api/data/activities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(activities),
    });
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    return true;
  } catch (e) {
    console.error('Failed to save activities to server:', e);
    return false;
  }
}

export async function fetchLiveUserActivities(
  account: RedditAccount
): Promise<{ items: ActivityItem[]; userInfo?: any }> {
  try {
    const res = await fetch(`/api/reddit/user/${encodeURIComponent(account.username)}/activity`);
    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}`);
    }
    const data = await res.json();
    if (data.success && Array.isArray(data.items) && data.items.length > 0) {
      const mappedItems: ActivityItem[] = data.items.map((it: any) => ({
        id: it.id || `live-${account.id}-${it.createdUtc}`,
        accountId: account.id,
        username: account.username,
        accountHolder: account.accountHolder,
        persona: account.persona,
        type: it.type || 'post',
        title: it.title,
        parentTitle: it.parentTitle,
        body: it.body || '',
        subreddit: normalizeSubreddit(it.subreddit),
        score: it.score ?? 1,
        upvoteRatio: it.upvoteRatio,
        numComments: it.numComments,
        createdUtc: it.createdUtc || Math.floor(Date.now() / 1000),
        permalink: it.permalink || `https://reddit.com/user/${account.username}`,
        url: it.url,
        isTargetSubreddit: isSubredditMatch(it.subreddit, account.targetSubreddits),
      }));

      return { items: mappedItems, userInfo: data.userInfo };
    }
  } catch (err) {
    console.warn(`[RedditService] Live fetch failed for ${account.username}:`, err);
  }

  return { items: [] };
}

export async function verifyRedditUsername(username: string): Promise<{
  valid: boolean;
  karma?: { total: number; post: number; comment: number };
  avatarUrl?: string;
  createdUtc?: number;
  message?: string;
}> {
  const clean = username.replace(/^(u\/|r\/|@)/, '').trim();
  if (!clean) return { valid: false, message: 'Username cannot be empty.' };

  try {
    const res = await fetch(`/api/reddit/user/${encodeURIComponent(clean)}/about`);
    const data = await res.json();

    if (data.success && data.data) {
      if (data.data.isSuspended) {
        return { valid: false, message: `u/${clean} is suspended on Reddit.` };
      }
      return {
        valid: true,
        karma: {
          total: data.data.totalKarma,
          post: data.data.postKarma,
          comment: data.data.commentKarma,
        },
        avatarUrl: data.data.avatarUrl,
        createdUtc: data.data.createdUtc,
      };
    }

    // Live lookup reached the server but Reddit says the account doesn't exist / is unreachable
    return { valid: false, message: data.message || `Account u/${clean} not found on Reddit.` };
  } catch (e) {
    // Network failure talking to our own backend (not a Reddit 404) — surface clearly, no fake data
    return { valid: false, message: 'Could not reach the server to verify. Check your connection and try again.' };
  }
}
