import type {
  IAgoraRTCClient,
  IAgoraRTCRemoteUser,
  ICameraVideoTrack,
  IMicrophoneAudioTrack,
  IRemoteAudioTrack,
  IRemoteVideoTrack,
  ConnectionState,
} from "agora-rtc-sdk-ng";

/**
 * The Agora Web SDK, wrapped so it can be reasoned about without React in the
 * way (SPEC §9).
 *
 * **The SDK is dynamically imported.** It touches `window` at module scope and
 * does not tolerate SSR, so it must not be reachable from a top-level import in
 * anything Next renders on the server. Only the `import type`s above are static,
 * and those are erased at build.
 *
 * **The media split is enforced here, not in the token.** The tutor publishes
 * microphone *and* camera; the student publishes microphone only and subscribes
 * to the tutor's video (SPEC §9, confirmed against the live app). Both hold a
 * `publisher` token — a `subscriber` token would forbid the student the audio
 * this design requires them to send, and would only appear to work while Agora's
 * co-host authentication happens to be off. `isTutor` comes from the token route,
 * which derives it from the booking; nothing in this file compares ids.
 *
 * **Cleanup is the hard part and is the reason this is a class.** A leaked local
 * track is a camera light that stays on after someone has left the page — the
 * user's laptop says they are still in a call. The instance is constructed
 * synchronously, so a React effect can always call {@link SessionClient.leave}
 * in its cleanup, *including while `join()` is still in flight*: `leave()` marks
 * the instance disposed and every `await` inside `join()` re-checks that flag and
 * tears down whatever it has already created. That is the case a naive
 * "`if (joined) leave()`" misses — a fast unmount during device acquisition — and
 * it is the one that strands the camera.
 */

/** What `POST /api/agora/token` returns. Nothing here is computed in the browser. */
export interface SessionTokenGrant {
  token: string;
  uid: number;
  appId: string;
  channel: string;
  expiresAt: string;
  /** Server-derived. The only input to the publish decision. */
  isTutor: boolean;
}

export interface SessionClientHandlers {
  /** The local camera track, or null once it is gone. Tutor only. */
  onLocalVideo?(track: ICameraVideoTrack | null): void;
  /** The remote camera track, or null when the peer unpublishes or leaves. */
  onRemoteVideo?(track: IRemoteVideoTrack | null): void;
  /** The remote microphone track. Playback is handled here; this is for meters/UI. */
  onRemoteAudio?(track: IRemoteAudioTrack | null): void;
  /** Whether the other participant is currently in the channel. */
  onRemotePresence?(present: boolean): void;
  onConnectionState?(state: ConnectionState): void;
  /** A failure after a successful join (device lost, publish rejected). */
  onError?(err: unknown): void;
}

type Phase = "idle" | "joining" | "joined" | "disposed";

export class SessionClient {
  #handlers: SessionClientHandlers;
  #phase: Phase = "idle";
  #client: IAgoraRTCClient | null = null;
  #mic: IMicrophoneAudioTrack | null = null;
  #camera: ICameraVideoTrack | null = null;
  #micEnabled = true;
  #cameraEnabled = true;
  /** In-flight `join()`, so `leave()` can wait for it to unwind before tearing down. */
  #joining: Promise<void> | null = null;
  #remoteUid: string | number | null = null;

  constructor(handlers: SessionClientHandlers = {}) {
    this.#handlers = handlers;
  }

  get disposed(): boolean {
    return this.#phase === "disposed";
  }

  /**
   * Join the channel and publish this participant's tracks.
   *
   * Safe to abandon: if {@link leave} runs at any point during this, the next
   * checkpoint stops and hands everything created so far to the teardown.
   */
  async join(grant: SessionTokenGrant): Promise<void> {
    if (this.#phase !== "idle") return;
    this.#phase = "joining";
    this.#joining = this.#doJoin(grant);
    try {
      await this.#joining;
    } catch (err) {
      // A throw partway through — permission denied, no microphone, publish
      // rejected — can leave us joined to the channel with nothing published:
      // a ghost participant the other side can see and cannot talk to. Release
      // everything before the failure surfaces, and mark the instance spent, so
      // a retry builds a fresh one rather than resuming a half-open channel.
      this.#phase = "disposed";
      await this.#teardown();
      throw err;
    } finally {
      this.#joining = null;
    }
  }

  async #doJoin(grant: SessionTokenGrant): Promise<void> {
    // Dynamic, for the SSR reason in the module note. `default` is the SDK object.
    const { default: AgoraRTC } = await import("agora-rtc-sdk-ng");
    if (this.disposed) return;

    // `rtc` mode: a two-way call, not a broadcast (§9, confirmed against the
    // live app's `live_session_room`).
    const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
    this.#client = client;

    // Listeners attach BEFORE join. Agora replays `user-published` for anyone
    // already publishing when we arrive, and binding afterwards races that
    // replay — the symptom being an empty tile for the person who got there first.
    this.#bind(client);

    await client.join(grant.appId, grant.channel, grant.token, grant.uid);
    if (this.disposed) return this.#teardown();

    const tracks = await this.#createLocalTracks(AgoraRTC, grant.isTutor);
    if (this.disposed) return this.#teardown();

    await client.publish(tracks);
    if (this.disposed) return this.#teardown();

    this.#phase = "joined";
    if (this.#camera) this.#handlers.onLocalVideo?.(this.#camera);
  }

  /**
   * Mute or unmute the local microphone (SPEC §9's `toggleMic`).
   *
   * `setEnabled`, not unpublish/republish: it stops capture and tells the
   * remote side the track is muted without renegotiating the channel, and it
   * is the pairing `setMuted` warns not to mix with (SDK docs). Every
   * participant has a microphone track, so there is nothing to guard here
   * beyond having joined.
   *
   * Returns the enabled state that took effect. If the SDK call itself throws
   * (device vanished mid-toggle), the flip is rolled back so the returned
   * value matches what is actually publishing, and the failure surfaces
   * through `onError` the same way a lost device does elsewhere in this class.
   */
  async toggleMic(): Promise<boolean> {
    if (!this.#mic) return this.#micEnabled;
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

  /**
   * Turn the local camera on or off (SPEC §9's `toggleCamera`) — **tutor
   * only**. The student never creates a camera track (§9, confirmed against
   * the live app: tutor publishes camera + microphone, student publishes
   * microphone only), so `#camera` is null for a student session and this is
   * a deliberate no-op returning `null` rather than a state that does not
   * exist. A caller building the control bar uses that `null` to decide
   * whether to render the button at all, rather than inferring it from
   * `isTutor` a second time.
   */
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

  /**
   * Swap in a freshly renewed token without dropping the connection (SPEC §9
   * step 6). The channel, uid and app id are unchanged — only the credential
   * is — so this is `client.renewToken`, not a leave/rejoin.
   *
   * A no-op before `join()` has reached `"joined"` or after `leave()`: there
   * is no live `IAgoraRTCClient` to hand the token to, and the caller (the
   * renewal scheduler) is expected to stop scheduling once the room is gone
   * rather than rely on this swallowing the call.
   */
  async renewToken(token: string): Promise<void> {
    if (this.#phase !== "joined" || !this.#client) return;
    await this.#client.renewToken(token);
  }

  /**
   * Create exactly the tracks this participant publishes.
   *
   * The tutor's pair is created in one call so the browser raises a single
   * permission prompt rather than two. Assigning to the fields *before* the next
   * `await` matters: it is what lets a concurrent `leave()` find and close them.
   */
  async #createLocalTracks(
    AgoraRTC: typeof import("agora-rtc-sdk-ng").default,
    isTutor: boolean,
  ): Promise<(IMicrophoneAudioTrack | ICameraVideoTrack)[]> {
    if (isTutor) {
      const [mic, camera] = await AgoraRTC.createMicrophoneAndCameraTracks();
      this.#mic = mic;
      this.#camera = camera;
      return [mic, camera];
    }
    // Student: microphone only. No camera track is ever created, so there is no
    // camera to leak and no permission prompt for one.
    const mic = await AgoraRTC.createMicrophoneAudioTrack();
    this.#mic = mic;
    return [mic];
  }

  #bind(client: IAgoraRTCClient): void {
    client.on("user-published", (user, mediaType) => {
      // The SDK also reports "datachannel"; this room has no data channel and
      // subscribing to one would open a stream nothing reads.
      if (mediaType !== "audio" && mediaType !== "video") return;
      void this.#onPublished(client, user, mediaType);
    });

    client.on("user-unpublished", (_user, mediaType) => {
      if (mediaType === "video") this.#handlers.onRemoteVideo?.(null);
      if (mediaType === "audio") this.#handlers.onRemoteAudio?.(null);
    });

    client.on("user-left", (user) => {
      if (this.#remoteUid !== null && user.uid !== this.#remoteUid) return;
      this.#remoteUid = null;
      this.#handlers.onRemoteVideo?.(null);
      this.#handlers.onRemoteAudio?.(null);
      this.#handlers.onRemotePresence?.(false);
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
    // The event can land after we have started leaving; subscribing then opens a
    // stream nothing will ever close.
    if (this.disposed) return;
    try {
      await client.subscribe(user, mediaType);
      if (this.disposed) return;

      this.#remoteUid = user.uid;
      this.#handlers.onRemotePresence?.(true);

      if (mediaType === "audio") {
        // Audio plays itself — there is no element to attach it to, and leaving
        // it unplayed is the classic "we can see them but not hear them".
        user.audioTrack?.play();
        this.#handlers.onRemoteAudio?.(user.audioTrack ?? null);
      } else {
        this.#handlers.onRemoteVideo?.(user.videoTrack ?? null);
      }
    } catch (err) {
      if (!this.disposed) this.#handlers.onError?.(err);
    }
  }

  /**
   * Leave the channel and release every device.
   *
   * Idempotent, and safe to call while `join()` is mid-flight — that is the
   * point. Never rejects: this runs from effect cleanup and `pagehide`, where a
   * throw is unhandled and buys nothing.
   */
  async leave(): Promise<void> {
    if (this.disposed) return;
    this.#phase = "disposed";
    // Let an in-flight join reach its next checkpoint and bail. It tears down
    // what it made; anything it had already stored is caught below regardless.
    if (this.#joining) await this.#joining.catch(() => {});
    await this.#teardown();
  }

  /**
   * Stop and close local tracks, drop listeners, leave the channel.
   *
   * `stop()` detaches from the DOM; **`close()` is what releases the hardware** —
   * stopping alone leaves the camera light on. Each step is independently
   * guarded, because a failure releasing one device must not strand the next.
   */
  async #teardown(): Promise<void> {
    const client = this.#client;
    const local = [this.#mic, this.#camera];
    this.#client = null;
    this.#mic = null;
    this.#camera = null;
    this.#remoteUid = null;

    for (const track of local) {
      if (!track) continue;
      try {
        track.stop();
        track.close();
      } catch {
        // Already closed, or the device vanished. Nothing left to release.
      }
    }
    this.#handlers.onLocalVideo?.(null);
    this.#handlers.onRemoteVideo?.(null);
    this.#handlers.onRemoteAudio?.(null);

    if (!client) return;
    try {
      client.removeAllListeners();
      await client.leave();
    } catch {
      // A channel we cannot leave cleanly is one the SDK has already dropped.
    }
  }
}
