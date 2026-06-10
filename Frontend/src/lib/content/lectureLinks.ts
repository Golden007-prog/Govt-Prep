import { allChannels } from '../taxonomy/registry';

/**
 * Lecture Link-outs (feature #12): we never rehost or fetch third-party video
 * content — we deep-link curated YouTube searches across the whitelisted
 * channels (Frontend/src/data/channels.json, via the taxonomy registry).
 */

/** One curated lecture search link. */
export interface LectureLink {
  channel: string;
  url: string;
}

function searchUrl(parts: Array<string | undefined>): string {
  const query = parts
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    .join(' ');
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

/**
 * Build one YouTube search URL per whitelisted channel for a topic — query
 * "channelName topicName [subjectName] lecture", channels ordered most-trusted
 * first — plus a final generic "All of YouTube" search without a channel.
 */
export function lectureLinks(topicName: string, subjectName?: string): LectureLink[] {
  const links: LectureLink[] = [...allChannels()]
    .sort((a, b) => b.trust - a.trust)
    .map((c) => ({
      channel: c.name,
      url: searchUrl([c.name, topicName, subjectName, 'lecture']),
    }));
  links.push({
    channel: 'All of YouTube',
    url: searchUrl([topicName, subjectName, 'lecture']),
  });
  return links;
}
