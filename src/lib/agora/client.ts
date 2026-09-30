import type {
  IAgoraRTCClient,
  IAgoraRTCRemoteUser,
  ICameraVideoTrack,
  ILocalVideoTrack,
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
 * **The media split is enforced here, not in the token.** Both participants
 * publish microphone and camera (room features, 2026-09-30; until then the
 * student sent audio only, SPEC §9). The difference between the roles is how
 * strict the camera is: a tutor without a working camera cannot join, because
 * the tutor's picture is the product; a student whose camera is missing or
 * blocked joins with audio only (`hasCamera` false) rather than being turned
 * away. Both hold a `publisher` token — a `subscriber` token would forbid the
 * audio this design requires them to send, and would only appear to work while
 * Agora's co-host authentication happens to be off. `isTutor` comes from the
 * token route, which derives it from the booking; nothing in this file compares
 * ids.
 *
 * **Screen share swaps the video track, it does not add one.** An
 * `AgoraRTCClient` publishes one video track at a time (the SDK refuses a
 * second with `CAN_NOT_PUBLISH_MULTIPLE_VIDEO_TRACKS`), so `startScreenShare`
 * unpublishes the camera, publishes the screen track, and `stopScreenShare`
 * reverses it, restoring the camera's enabled state. The other side sees one
 * `user-unpublished` then one `user-published` for video and simply shows the
 * new picture; which it is (camera or screen) travels on the room's own signal
 * channel (`hooks/use-session-share-signal.ts`), not through Agora.
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
  /** The local camera track, or null once it is gone (or never existed). */
  onLocalVideo?(track: ICameraVideoTrack | null): void;
  /** The local screen track while sharing, null when sharing stops. */
  onLocalScreen?(track: ILocalVideoTrack | null): void;
  /** The remote camera track, or null when the peer unpublishes or leaves. */
  onRemoteVideo?(track: IRemoteVideoTrack | null): void;
  /** The remote microphone track. Playback is handled here; this is for meters/UI. */
  onRemoteAudio?(track: IRemoteAudioTrack | null): void;
  /** Whether the other participant is currently in the channel. */
  onRemotePresence?(present: boolean): void;
  onConnectionState?(state: ConnectionState): void;
  /**
   * Network quality, as the SDK reports it about every two seconds once
   * joined: 0 unknown, 1 excellent to 6 down (Agora's scale). `remote` is the
   * other participant's uplink, or 0 when they aren't here. Display only.
   */
  onNetworkQuality?(quality: NetworkQuality): void;
  /** A failure after a successful join (device lost, publish rejected). */
  onError?(err: unknown): void;
}

export interface NetworkQuality {
  uplink: number;
  downlink: number;
  remote: number;
}

type Phase = "idle" | "joining" | "joined" | "disposed";

export class SessionClient {
  #handlers: SessionClientHandlers;
  #phase: Phase = "idle";
  #client: IAgoraRTCClient | null = null;
  #mic: IMicrophoneAudioTrack | null = null;
  #camera: ICameraVideoTrack | null = null;
  #screen: ILocalVideoTrack | null = null;
  #micEnabled = true;
  #cameraEnabled = true;
  /** Serializes start/stop so a double click cannot publish twice. */
  #sharing: Promise<void> | null = null;
  /** In-flight `join()`, so `leave()` can wait for it to unwind before tearing down. */
  #joining: Promise<void> | null = null;
  #remoteUid: string | number | null = null;

  constructor(handlers: SessionClientHandlers = {}) {
    this.#handlers = handlers;
  }

  get disposed(): boolean {
    return this.#phase === "disposed";
  }

  /** False for a student who joined without a camera (missing or blocked). */
  get hasCamera(): boolean {
    return this.#camera !== null;
  }

  get sharingScreen(): boolean {
    return this.#screen !== null;
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
   * Turn the local camera on or off (SPEC §9's `toggleCamera`). `#camera` is
   * null for a student who joined without one (missing or blocked, see
   * `#createLocalTracks`), and then this is a deliberate no-op returning `null`
   * rather than a state that does not exist. A caller building the control bar
   * uses that `null` to decide whether to render the button at all. While the
   * screen is being shared the camera is unpublished, so the flip is remembered
   * on the track and takes effect when the share stops.
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
   * Create the tracks this participant publishes: microphone and camera, for
   * both roles (2026-09-30).
   *
   * The pair is created in one call so the browser raises a single permission
   * prompt rather than two. Assigning to the fields *before* the next `await`
   * matters: it is what lets a concurrent `leave()` find and close them.
   *
   * A **student** whose camera fails (none plugged in, blocked in the address
   * bar, in use elsewhere) still joins: the failure is swallowed, the
   * microphone is created on its own and `hasCamera` stays false. A **tutor's**
   * camera failure is a join failure, as before: the tutor's picture is what
   * the student paid for.
   */
  async #createLocalTracks(
    AgoraRTC: typeof import("agora-rtc-sdk-ng").default,
    isTutor: boolean,
  ): Promise<(IMicrophoneAudioTrack | ICameraVideoTrack)[]> {
    try {
      const [mic, camera] = await AgoraRTC.createMicrophoneAndCameraTracks();
      this.#mic = mic;
      this.#camera = camera;
      return [mic, camera];
    } catch (err) {
      if (isTutor || this.disposed) throw err;
    }
    // Student, camera unavailable: microphone only. The prompt for the camera
    // has been answered (or there was nothing to ask for), so this asks once
    // more for the microphone alone.
    const mic = await AgoraRTC.createMicrophoneAudioTrack();
    this.#mic = mic;
    return [mic];
  }

  /**
   * Share this screen (SPEC §9's `startScreenShare`, built 2026-09-30).
   *
   * The browser's own picker chooses the screen, window or tab. The screen
   * track replaces the camera on the wire (see the module note); the camera
   * track is kept alive, unpublished, so stopping the share is a republish and
   * not a new permission prompt. When the person stops sharing from the
   * browser's own bar, the SDK fires `track-ended` and this stops itself.
   *
   * Returns true once the screen is publishing. False when the picker was
   * dismissed, the browser has no screen capture, or a share is already on;
   * the failure reason is handed to `onError` when there is one worth saying.
   */
  async startScreenShare(): Promise<boolean> {
    if (this.#phase !== "joined" || !this.#client || this.#screen || this.#sharing) return false;
    const client = this.#client;
    let ok = false;
    this.#sharing = (async () => {
      const { default: AgoraRTC } = await import("agora-rtc-sdk-ng");
      if (this.disposed) return;
      let screen: ILocalVideoTrack;
      try {
        screen = await AgoraRTC.createScreenVideoTrack({ encoderConfig: "1080p_1" }, "disable");
      } catch (err) {
        // Dismissing the picker is the common case and not an error worth a
        // banner. Anything else is.
        const code = (err as { code?: unknown } | null)?.code;
        if (code !== "PERMISSION_DENIED") this.#handlers.onError?.(err);
        return;
      }
      if (this.disposed) {
        screen.stop();
        screen.close();
        return;
      }
      this.#screen = screen;
      screen.on("track-ended", () => void this.stopScreenShare());
      try {
        if (this.#camera) await client.unpublish(this.#camera);
        await client.publish(screen);
        this.#handlers.onLocalScreen?.(screen);
        ok = true;
      } catch (err) {
        this.#screen = null;
        screen.stop();
        screen.close();
        // Put the camera back rather than leaving the room with no video.
        if (this.#camera && !this.disposed) await client.publish(this.#camera).catch(() => {});
        this.#handlers.onError?.(err);
      }
    })().finally(() => {
      this.#sharing = null;
    });
    await this.#sharing;
    return ok;
  }

  /** Stop sharing and put the camera back on the wire. Idempotent. */
  async stopScreenShare(): Promise<void> {
    if (this.#sharing) await this.#sharing.catch(() => {});
    const screen = this.#screen;
    if (!screen) return;
    this.#screen = null;
    this.#handlers.onLocalScreen?.(null);
    const client = this.#client;
    try {
      screen.stop();
      screen.close();
    } catch {
      // Already ended by the browser.
    }
    if (!client || this.disposed) return;
    try {
      await client.unpublish(screen);
    } catch {
      // The SDK dropped it with the ended track; nothing left to unpublish.
    }
    if (this.#camera) {
      try {
        await client.publish(this.#camera);
      } catch (err) {
        this.#handlers.onError?.(err);
      }
    }
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

    // Fired by the SDK on its own schedule; nothing here polls. The remote
    // figure is read in the same tick from the SDK's cached stats.
    client.on("network-quality", (stats) => {
      if (this.disposed) return;
      let remote = 0;
      if (this.#remoteUid !== null) {
        try {
          remote = client.getRemoteNetworkQuality()[String(this.#remoteUid)]?.uplinkNetworkQuality ?? 0;
        } catch {
          remote = 0;
        }
      }
      this.#handlers.onNetworkQuality?.({
        uplink: stats.uplinkNetworkQuality,
        downlink: stats.downlinkNetworkQuality,
        remote,
      });
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
    const local = [this.#mic, this.#camera, this.#screen];
    this.#client = null;
    this.#mic = null;
    this.#camera = null;
    this.#screen = null;
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
    this.#handlers.onLocalScreen?.(null);
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
