const GW2_API_URL = 'https://api.guildwars2.com';

const FETCH_OPTIONS: RequestInit = {
  method: 'GET',
  mode: 'cors',
  credentials: 'omit',
  redirect: 'error',
};

// All ids used by the API are numeric, so let's name a type for readability.
export type Id = number;

async function fetch_api(path: string): Promise<unknown> {
  let url = GW2_API_URL + path;
  let res = await fetch(url, FETCH_OPTIONS);
  if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
  let json = await res.json();
  return json;
}

// A few type guards to check API responses
function isPlainObject(o: unknown): o is Record<string, unknown> {
  return (
    typeof o === 'object' &&
    o !== null &&
    Object.getPrototypeOf(o) === Object.prototype
  );
}
function isObjectWithId(o: unknown): o is { id: Id } {
  return (
    isPlainObject(o) &&
    'id' in o &&
    typeof o.id === 'number' &&
    Number.isInteger(o.id) &&
    o.id > 0
  );
}

// Define return types for the getter methods
export type APICacheGetOneResult<T> =
  | {
      loading: true;
      error: false;
      data: null;
    }
  | {
      loading: false;
      error: true | string;
      data: null;
    }
  | {
      loading: false;
      error: false;
      data: T;
    };

export interface APICacheGetMultipleResult<T> {
  loading: boolean;
  error: boolean | string;
  data: Record<Id, T>;
}

export default class APICache<T extends { id: Id }> {
  private path: string; // The relative URL of the API endpoint
  // All known Ts returned from the API. If an entry is null, then there was an error.
  private cache: Map<Id, T | null> = new Map();
  // For proper batching, we limit the number of concurrent requests.
  // A new request is only generated once previous requests finish.
  private requests_inflight: number = 0;
  private max_concurrent_requests: number;
  // Callbacks of everyone currently waiting for new data.
  private callbacks: Set<() => void> = new Set();
  // Ids that some client is interested in, but that aren't in the cache yet.
  private requested_ids: Set<Id> = new Set();
  // Ids that are currently being fetched from the API.
  private fetched_ids: Set<Id> = new Set();
  // We need to delay fetching for a bit to give more than one component time to tell us their needs.
  private fetch_delay_timeout: ReturnType<typeof setTimeout> | null = null;
  // Different endpoints may have different limits on the amount of items you can fetch in single request
  private max_ids_per_request: number;

  constructor(
    path: string,
    max_ids_per_request: number = 200,
    max_concurrent_requests: number = 1,
  ) {
    // Nothing else to do in the constructor
    this.path = path;
    this.max_ids_per_request = max_ids_per_request;
    this.max_concurrent_requests = max_concurrent_requests;
  }

  public getMultiple(
    ids: Id[],
    callback: () => void,
  ): APICacheGetMultipleResult<T> {
    let missing = 0;
    for (let id of ids) {
      if (!this.cache.has(id)) {
        this.requested_ids.add(id);
        missing++;
      }
    }

    if (missing > 0) {
      this.callbacks.add(callback);
      this.fetchLater();
    }

    let errored = 0;
    let map: Record<Id, T> = {};
    for (let id of ids) {
      let item = this.cache.get(id);
      if (item === undefined) {
        missing++;
      } else if (item === null) {
        errored++;
      } else {
        map[id] = item;
      }
    }
    return {
      loading: missing > 0,
      error: errored > 0,
      data: map,
    };
  }

  public getOne(id: Id, callback: () => void): APICacheGetOneResult<T> {
    let res = this.getMultiple([id], callback);
    let item = res.data[id];
    if (res.loading) {
      return {
        loading: true,
        error: false,
        data: null,
      };
    } else if (res.error) {
      return {
        loading: false,
        error: res.error,
        data: null,
      };
    } else if (item) {
      return {
        loading: false,
        error: false,
        data: item,
      };
    }

    // This should never happen, but typescript complains if we don't handle this case
    console.error('APICache: invalid state reached', id, res);
    return {
      loading: false,
      error: true,
      data: null,
    };
  }

  private fetchLater() {
    if (this.fetch_delay_timeout) return;
    this.fetch_delay_timeout = setTimeout(
      () => {
        this.fetch_delay_timeout = null;
        this.tryFetch();
      },
      process.env.NODE_ENV === 'development' ? 1000 : 0,
    );
  }

  private async tryFetch() {
    if (this.max_concurrent_requests - this.requests_inflight < 1) {
      // We cannot send another request right now.
      // When a previous request finishes, we'll automatically try again.
      return;
    }

    // Figure out which ids we need to fetch, if any.
    if (this.requested_ids.size <= this.fetched_ids.size) {
      return;
    }
    let ids: Id[] = [];
    for (let id of this.requested_ids.values()) {
      if (!this.fetched_ids.has(id)) {
        ids.push(id);
      }
      if (ids.length >= this.max_ids_per_request) {
        break;
      }
    }

    // No ids? Good, nothing to do then.
    if (ids.length < 1) {
      return;
    }

    // We got ids and we're allowed to send another request, so let's do this.
    this.requests_inflight++;
    for (let id of ids) {
      this.fetched_ids.add(id);
    }
    let response: unknown[];
    try {
      ids.sort();
      let json = await fetch_api(this.path + '?ids=' + ids.join(','));
      if (!(json instanceof Array)) {
        throw new Error('Response is not a list');
      }
      response = json;
    } catch (e) {
      // If there is an error, we treat is as an empty response.
      response = [];
      console.error(e);
    }
    this.requests_inflight--;

    // Check our responses, and enter them into the cache.
    for (let o of response) {
      if (!isObjectWithId(o)) {
        console.error('Response contains unexpected value', o);
        continue;
      }

      // We trust the API that the rest of the object is correct.
      this.cache.set(o.id, o as T);
    }

    // See if all requested ids were returned
    for (let id of ids) {
      if (!this.cache.has(id)) {
        // mark missing ids as errors
        this.cache.set(id, null);
      }
      // mark the ids as fetched
      this.requested_ids.delete(id);
      this.fetched_ids.delete(id);
    }

    // The cache has changed, we need to notify all clients.
    // The clients will call get() again, and if there are items missing, their callbacks will be registered again.
    // Thus we need to clear the set beforehand, and work on a copy.
    let callbacks = [...this.callbacks];
    this.callbacks.clear();
    for (let c of callbacks) {
      try {
        c();
      } catch (e) {
        console.error('callback failed', e);
      }
    }

    // Maybe there are more unfetched ids, so let's try again
    this.tryFetch();
  }
}
