export interface FeedTransportResponse {
  body: string;
  status: number;
  finalUrl?: string;
}

export interface FeedTransport {
  fetch(url: string, signal?: AbortSignal): Promise<FeedTransportResponse>;
}

export interface RequestUrlResponseLike {
  status: number;
  text: string;
}

export type RequestUrlLike = (request: {
  url: string;
  method: 'GET';
  headers: Record<string, string>;
  throw: false;
}) => Promise<RequestUrlResponseLike>;

export function createObsidianFeedTransport(
  requestUrl: RequestUrlLike,
): FeedTransport {
  return {
    async fetch(url: string): Promise<FeedTransportResponse> {
      assertHttpUrl(url);
      const response = await requestUrl({
        url,
        method: 'GET',
        headers: {
          Accept:
            'application/atom+xml, application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1',
        },
        throw: false,
      });
      return { body: response.text, status: response.status };
    },
  };
}

export function assertHttpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(`Invalid feed URL: ${value}`, { cause: error });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Unsupported feed URL protocol: ${url.protocol}`);
  }
  return url;
}
