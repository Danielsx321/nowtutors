import type {
  ConnectionState,
  IAgoraRTCClient,
  IAgoraRTCRemoteUser,
  ICameraVideoTrack,
  IMicrophoneAudioTrack,
  IRemoteVideoTrack,
} from "agora-rtc-sdk-ng";

/**
 * The Agora Web SDK in `live` mode, for broadcasts (SPEC §7.8, §9; Phase 9
 * Part 3). The sibling of `client.ts`, which is `rtc` mode for 1:1 sessions.
 *
 * **Host or audience comes from the token route**, as `isHost`. The host joins
 * as `host` and publishes camera and microphone; everyone else joins as
 * `audience`, publishes nothing, creates no local track (so no permission
 * prompt) and subscribes to the host. A viewer's token is `subscriber` anyway,
 * so a tampered client that tried to publish would be refused by Agora.
 *
 * **Audience latency is "low" (level 1), not the SDK default "ultra-low"**,
 * which Agora bills at a higher rate. A second or two of delay is fine for a
 * one-way lesson.
 *
 * **Cleanup follows `client.ts` exactly**: the instance is constructed
 * synchronously so an effect can always `leave()`, including while `join()` is
 * still awaiting device permission, and every await in `join()` re-checks the
 * disposed flag. A leaked camera track is a camera light left on.
 *
 * The SDK is dynamically imported: it touches `window` at module scope.
 */

/** What `POST /api/agora/token` returns for `{ broadcastId }`. */
export interface BroadcastTokenGrant {
  token: string;
  uid: number;
  appId: string;
  channel: string;
  expiresAt: string;
  /** Server-derived. The only input to the host/audience decision. */
  isHost: boolean;
}

export interface LiveClientHandlers {
  /** The host's own camera track, or null once it is gone. Host only. */
  onLocalVideo?(track: ICameraVideoTrack | null): void;
  /** The host's video as a viewer sees it, or null when it stops. Audience only. */
  onHostVideo?(track: IRemoteVideoTrack | null): void;
  /**
   * Audience only: the host started publishing (true) or left the channel
   * (false). A false is the viewer page's cue to ask the server whether the
   * broadcast has ended.
   */
  onHostPresence?(present: boolean): void;
  onConnectionState?(state: ConnectionState): void;
  /** A failure after a successful join (device lost, publish rejected). */
  onError?(err: unknown): void;
}

type Phase = "idle" | "joining" | "joined" | "disposed";
type ClientRoleOptions = Parameters<IAgoraRTCClient["setClientRole"]>[1];

/** Agora's `AudienceLatencyLevelType.AUDIENCE_LEVEL_LOW_LATENCY`. */
const AUDIENCE_LEVEL_LOW_LATENCY = 1;

export class LiveClient {
  #handlers: LiveClientHandlers;
  #phase: Phase = "idle";
  #client: IAgoraRTCClient | null = null;
  #mic: IMicrophoneAudioTrack | null = null;
  #camera: ICameraVideoTrack | null = null;
  #micEnabled = true;
  #cameraEnabled = true;
  #joining: Promise<void> | null = null;
  #hostUid: string | number | null = null;

  constructor(handlers: LiveClientHandlers = {}) {
    this.#handlers = handlers;
  }

  get disposed(): boolean {
    return this.#phase === "disposed";
  }

  async join(grant: BroadcastTokenGrant): Promise<void> {
    if (this.#phase !== "idle") return;
    this.#phase = "joining";
    this.#joining = this.#doJoin(grant);
    try {
      await this.#joining;
    } catch (err) {
      // Same reason as `SessionClient.join`: a throw partway through can leave a
      // half-joined channel. Release everything and mark the instance spent.
      this.#phase = "disposed";
      await this.#teardown();
      throw err;
    } finally {
      this.#joining = null;
    }
  }

  async #doJoin(grant: BroadcastTokenGrant): Promise<void> {
    const { default: AgoraRTC } = await import("agora-rtc-sdk-ng");
    if (this.disposed) return;

    const client = AgoraRTC.createClient({ mode: "live", codec: "vp8" });
    this.#client = client;
    // Before join, so a host already publishing when a viewer arrives is not
    // missed (Agora replays `user-published` on join).
    this.#bind(client, grant.isHost);

    if (grant.isHost) {
      await client.setClientRole("host");
    } else {
      await client.setClientRole("audience", {
        level: AUDIENCE_LEVEL_LOW_LATENCY,
      } as ClientRoleOptions);
    }
    if (this.disposed) return this.#teardown();

    await client.join(grant.appId, grant.channel, grant.token, grant.uid);
    if (this.disposed) return this.#teardown();

    if (grant.isHost) {
      // One call, one permission prompt. Fields assigned before the next await
      // so a concurrent leave() can find and close them.
      const [mic, camera] = await AgoraRTC.createMicrophoneAndCameraTracks();
      this.#mic = mic;
      this.#camera = camera;
      if (this.disposed) return this.#teardown();

      await client.publish([mic, camera]);
      if (this.disposed) return this.#teardown();
    }

    this.#phase = "joined";
    if (this.#camera) this.#handlers.onLocalVideo?.(this.#camera);
  }

  /** Host only. Returns the enabled state, or null for a viewer (no microphone). */
  async toggleMic(): Promise<boolean | null> {
    if (!this.#mic) return null;
    const next = !this.#micEnabled;
    this.#micEnabled = next;
    try {
      await this.#mic.setEnabled(next);
    } catch (err) {
      this.#micEnabled = !next;
      this.#handlers.onError?.(err);
    }
    return this.#micEnabled;
  }

  /** Host only. Returns the enabled state, or null for a viewer (no camera). */
  async toggleCamera(): Promise<boolean | null> {
    if (!this.#camera) return null;
    const next = !this.#cameraEnabled;
    this.#cameraEnabled = next;
    try {
      await this.#camera.setEnabled(next);
    } catch (err) {
      this.#cameraEnabled = !next;
      this.#handlers.onError?.(err);
    }
    return this.#cameraEnabled;
  }

  /** Swap in a renewed token without leaving the channel (SPEC §9 step 6). */
  async renewToken(token: string): Promise<void> {
    if (this.#phase !== "joined" || !this.#client) return;
    await this.#client.renewToken(token);
  }

  #bind(client: IAgoraRTCClient, isHost: boolean): void {
    // The host subscribes to nothing: a broadcast has one publisher.
    if (isHost) {
      client.on("connection-state-change", (state) => {
        this.#handlers.onConnectionState?.(state);
      });
      return;
    }

    client.on("user-published", (user, mediaType) => {
      if (mediaType !== "audio" && mediaType !== "video") return;
      void this.#onPublished(client, user, mediaType);
    });

    client.on("user-unpublished", (_user, mediaType) => {
      if (mediaType === "video") this.#handlers.onHostVideo?.(null);
    });

    client.on("user-left", (user) => {
      if (this.#hostUid !== null && user.uid !== this.#hostUid) return;
      this.#hostUid = null;
      this.#handlers.onHostVideo?.(null);
      this.#handlers.onHostPresence?.(false);
    });

    client.on("connection-state-change", (state) => {
      this.#handlers.onConnectionState?.(state);
    });
  }

  async #onPublished(
    client: IAgoraRTCClient,
    user: IAgoraRTCRemoteUser,
    mediaType: "audio" | "video",
  ): Promise<void> {
    if (this.disposed) return;
    try {
      await client.subscribe(user, mediaType);
      if (this.disposed) return;
      this.#hostUid = user.uid;
      this.#handlers.onHostPresence?.(true);
      if (mediaType === "audio") {
        user.audioTrack?.play();
      } else {
        this.#handlers.onHostVideo?.(user.videoTrack ?? null);
      }
    } catch (err) {
      if (!this.disposed) this.#handlers.onError?.(err);
    }
  }

  /** Leave and release every device. Idempotent, safe mid-join, never rejects. */
  async leave(): Promise<void> {
    if (this.disposed) return;
    this.#phase = "disposed";
    if (this.#joining) await this.#joining.catch(() => {});
    await this.#teardown();
  }

  async #teardown(): Promise<void> {
    const client = this.#client;
    const local = [this.#mic, this.#camera];
    this.#client = null;
    this.#mic = null;
    this.#camera = null;
    this.#hostUid = null;

    for (const track of local) {
      if (!track) continue;
      try {
        track.stop();
        track.close();
      } catch {
        // Already closed, or the device vanished.
      }
    }
    this.#handlers.onLocalVideo?.(null);
    this.#handlers.onHostVideo?.(null);

    if (!client) return;
    try {
      client.removeAllListeners();
      await client.leave();
    } catch {
      // A channel we cannot leave cleanly is one the SDK has already dropped.
    }
  }
}
