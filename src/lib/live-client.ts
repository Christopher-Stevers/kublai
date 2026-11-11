"use client";
import { isAppPageActive, subscribeAppPageActivity } from "./app-page-activity";
import { isOfflineTestEnabled } from "./offline-test";
import { liveHint, type LiveHint } from "./live-protocol";
export type LiveSubscription = {
  jobIds?: readonly string[];
  conversations?: boolean;
  preferences?: boolean;
  timesheets?: boolean;
  expectedAccount?: string;
};
export type LiveCallbacks = {
  hint: (hint: LiveHint) => void;
  status?: (connected: boolean) => void;
  preferencesReady?: (ready: boolean) => void;
  catchUp?: () => void;
};
type Subscriber = {
  options: LiveSubscription;
  callbacks: LiveCallbacks;
  account: string | null;
  generation: number;
};
/** One transport per authenticated browser document. Separate windows/iframes
 * remain separate documents; this is not a cross-tab leader-election protocol. */
export class LiveClient {
  private account: string | null = null;
  private generation = 0;
  private subscribers = new Set<Subscriber>();
  private source: EventSource | undefined;
  private connected = false;
  private preferencesReady = false;
  private cursor = "";
  private chatVersions = new Map<string, number>();
  private observers = new Set<(hint: LiveHint) => void>();
  private signature = "";
  private delay = 1000;
  private unsubscribeActivity: () => void;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private hiddenTimer: ReturnType<typeof setTimeout> | undefined;
  constructor() {
    window.addEventListener("online", this.resume);
    window.addEventListener("offline", this.offline);
    this.unsubscribeActivity = subscribeAppPageActivity(this.visibility);
  }
  private active() {
    return [...this.subscribers].filter(
      (sub) =>
        this.account !== null &&
        sub.account === this.account &&
        sub.generation === this.generation,
    );
  }
  private status(connected: boolean) {
    this.connected = connected;
    for (const sub of this.active()) {
      sub.callbacks.status?.(connected && this.available());
      sub.callbacks.preferencesReady?.(
        connected && this.preferencesReady && this.available(),
      );
    }
  }
  private stop() {
    clearTimeout(this.retry);
    this.retry = undefined;
    this.source?.close();
    this.source = undefined;
    this.preferencesReady = false;
    this.status(false);
  }
  private topics() {
    const active = this.active();
    return {
      jobs: [
        ...new Set(active.flatMap((sub) => sub.options.jobIds ?? [])),
      ].sort(),
      conversations: active.some((sub) => sub.options.conversations),
      preferences: active.some((sub) => sub.options.preferences),
      timesheets: active.some((sub) => sub.options.timesheets),
    };
  }
  private available() {
    return (
      this.account !== null &&
      this.active().length > 0 &&
      !isOfflineTestEnabled() &&
      navigator.onLine !== false &&
      isAppPageActive()
    );
  }
  private reconcile = () => {
    const topics = this.topics(),
      signature = JSON.stringify(topics);
    if (signature !== this.signature) {
      this.signature = signature;
      this.stop();
    }
    if (!this.available()) {
      if (!this.active().length || !this.account || navigator.onLine === false)
        this.stop();
      return;
    }
    if (!this.source && !this.retry)
      this.retry = setTimeout(() => {
        this.retry = undefined;
        this.open();
      }, 0);
  };
  private resume = () => {
    clearTimeout(this.hiddenTimer);
    this.hiddenTimer = undefined;
    if (this.source && this.connected && this.available()) {
      this.status(true);
      for (const sub of this.active()) sub.callbacks.catchUp?.();
    } else this.reconcile();
  };
  private offline = () => this.stop();
  private visibility = () => {
    if (!isAppPageActive()) {
      this.status(this.connected);
      clearTimeout(this.hiddenTimer);
      this.hiddenTimer = setTimeout(() => this.stop(), 15_000);
    } else this.resume();
  };
  private open() {
    if (!this.available() || this.source || typeof EventSource === "undefined")
      return;
    const topics = this.topics(),
      query = new URLSearchParams();
    if (topics.jobs.length)
      query.set(
        "jobs",
        topics.jobs
          .map((id) => `${id}:${this.chatVersions.get(id) ?? 0}`)
          .join(","),
      );
    if (topics.conversations) query.set("conversations", "1");
    if (topics.preferences) query.set("preferences", "1");
    if (topics.timesheets) query.set("timesheets", "1");
    if (this.cursor) query.set("after", this.cursor);
    const source = new EventSource(
      `/api/live${query.size ? "?" + query.toString() : ""}`,
    );
    this.source = source;
    source.addEventListener("connected", () => {
      if (this.source !== source) return;
      this.delay = 1000;
      this.status(true);
      if (this.available())
        for (const sub of this.active()) sub.callbacks.catchUp?.();
    });
    source.addEventListener("preferences-ready", (event) => {
      if (this.source !== source) return;
      let ready = false;
      try {
        const value: unknown = JSON.parse((event as MessageEvent<string>).data);
        ready =
          !!value &&
          typeof value === "object" &&
          "ready" in value &&
          value.ready === true;
      } catch {
        /* Stay unhealthy. */
      }
      this.preferencesReady = ready;
      for (const sub of this.active())
        if (sub.options.preferences)
          sub.callbacks.preferencesReady?.(
            ready && this.connected && this.available(),
          );
    });
    source.addEventListener("live", (event) => {
      if (this.source !== source) return;
      let hint: LiveHint | null;
      try {
        hint = liveHint(JSON.parse((event as MessageEvent<string>).data));
      } catch {
        return;
      }
      if (!hint) return;
      const cursor = (event as MessageEvent<string>).lastEventId;
      if (/^[a-f0-9-]{36}:\d+$/.test(cursor)) this.cursor = cursor;
      if (hint.topic === "chat" && hint.key)
        this.chatVersions.set(
          hint.key,
          Math.max(this.chatVersions.get(hint.key) ?? 0, hint.version),
        );
      if (!this.available()) return;
      if (
        hint.topic !== "chat-overview" ||
        this.topics().jobs.includes(hint.key ?? "")
      )
        for (const observer of this.observers) observer(hint);
      for (const sub of this.active())
        if (
          hint.topic === "chat" || hint.topic === "chat-overview"
            ? (sub.options.jobIds ?? []).includes(hint.key ?? "")
            : hint.topic === "conversations"
              ? sub.options.conversations
              : hint.topic === "preferences"
                ? sub.options.preferences
                : hint.topic === "timesheets"
                  ? sub.options.timesheets
                  : true
        )
          sub.callbacks.hint(hint);
    });
    source.onerror = () => {
      if (this.source !== source) return;
      source.close();
      this.source = undefined;
      this.preferencesReady = false;
      this.status(false);
      if (!this.available()) return;
      this.retry = setTimeout(() => {
        this.retry = undefined;
        this.open();
      }, this.delay);
      this.delay = Math.min(this.delay * 2, 30_000);
    };
  }
  setAccount(account: string | null) {
    if (account === this.account) return;
    this.stop();
    if (this.account !== null || account === null) this.generation++;
    this.account = account;
    this.cursor = "";
    this.chatVersions.clear();
    this.signature = "";
    this.delay = 1000;
    if (account !== null)
      for (const sub of this.subscribers)
        if (sub.account === null && sub.generation === this.generation)
          sub.account = account;
    this.reconcile();
  }
  subscribe(options: LiveSubscription, callbacks: LiveCallbacks) {
    const sub = {
      options,
      callbacks,
      account: options.expectedAccount ?? this.account,
      // A new scoped subscriber can mount before the bootstrap effect switches
      // the account. Reserve only that next generation; old subscribers never
      // become active again after an account round trip.
      generation:
        this.generation +
        (options.expectedAccount &&
        this.account !== null &&
        options.expectedAccount !== this.account
          ? 1
          : 0),
    };
    this.subscribers.add(sub);
    this.reconcile();
    const connected =
      this.active().includes(sub) && this.connected && this.available();
    callbacks.status?.(connected);
    callbacks.preferencesReady?.(connected && this.preferencesReady);
    if (connected) callbacks.catchUp?.();
    return () => {
      this.subscribers.delete(sub);
      this.reconcile();
    };
  }
  /** Passive cache observation only: never adds topics or opens a transport. */
  observe(listener: (hint: LiveHint) => void) {
    this.observers.add(listener);
    return () => {
      this.observers.delete(listener);
    };
  }
  dispose() {
    this.stop();
    clearTimeout(this.hiddenTimer);
    this.subscribers.clear();
    this.observers.clear();
    window.removeEventListener("online", this.resume);
    window.removeEventListener("offline", this.offline);
    this.unsubscribeActivity();
  }
}
let singleton: LiveClient | undefined;
function client() {
  return (singleton ??= new LiveClient());
}
let binding = 0;
export function bindLiveAccount(account: string) {
  const manager = client(),
    token = ++binding;
  manager.setAccount(account);
  return () => {
    if (binding === token) manager.setAccount(null);
  };
}
export function subscribeLiveEvents(
  options: LiveSubscription,
  callbacks: LiveCallbacks,
) {
  return client().subscribe(options, callbacks);
}

/** Observe only frames admitted by existing active subscriptions. */
export function observeLiveHints(listener: (hint: LiveHint) => void) {
  return client().observe(listener);
}
