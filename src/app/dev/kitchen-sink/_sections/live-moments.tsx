"use client";

import * as React from "react";
import { Section, type Surface } from "./kit";
import { Button } from "@/components/ui/button";
import { Modal, ModalContent } from "@/components/ui/modal";
import { VideoTile } from "@/components/features/session/video-tile";
import { ControlBar } from "@/components/features/session/control-bar";
import { ConnectionBanner } from "@/components/features/session/connection-banner";
import { WaitingForTutor } from "@/components/features/booking/waiting-for-tutor";

/**
 * The live moments (design overhaul Part 4), shown without a session: a room
 * needs two signed-in people and an Agora channel, so this is the only place to
 * look at the pieces side by side. Always rendered inside `.theme-dark`, like
 * the rooms. The Lobby is not here because it asks for the camera on mount.
 */
export function LiveMomentsSection({ surface }: { surface: Surface }) {
  const [mic, setMic] = React.useState(true);
  const [cam, setCam] = React.useState(false);
  const [waiting, setWaiting] = React.useState<string | null>(null);

  return (
    <Section id="live-moments" title="Live moments (rooms are always dark)" surface={surface}>
      <div className="theme-dark space-y-4 rounded-xl bg-surface p-4 text-text md:p-6">
        <p className="text-small text-text-muted">Spotlight: the tutor large, the student as a small tile.</p>
        <div className="space-y-3 md:relative md:space-y-0">
          <VideoTile primary name="Liam Bennett" roleLabel="Tutor" track={null} emptyReason="camera-off" />
          <div className="w-40 md:absolute md:bottom-3 md:right-3 md:w-52">
            <VideoTile compact name="Amara Okafor" roleLabel="You" track={null} muted={!mic} emptyReason="audio-only" />
          </div>
        </div>

        <ControlBar
          micEnabled={mic}
          cameraEnabled={cam}
          onToggleMic={() => setMic((m) => !m)}
          onToggleCamera={() => setCam((c) => !c)}
          layout="spotlight"
          onToggleLayout={() => {}}
          endAction={<Button variant="danger">End session</Button>}
        />

        <p className="text-small text-text-muted">Connection states, from the SDK&apos;s own events.</p>
        <ConnectionBanner phase="joining" connection={null} quality={null} otherRole="Your tutor" onRejoin={() => {}} />
        <ConnectionBanner
          phase="live"
          connection="CONNECTED"
          quality={{ uplink: 5, downlink: 4, remote: 1 }}
          otherRole="Your student"
          onTurnOffVideo={() => {}}
          onRejoin={() => {}}
        />
        <ConnectionBanner
          phase="live"
          connection="CONNECTED"
          quality={{ uplink: 1, downlink: 1, remote: 6 }}
          otherRole="Your tutor"
          onRejoin={() => {}}
        />
        <ConnectionBanner phase="live" connection="DISCONNECTED" quality={null} otherRole="Your tutor" onRejoin={() => {}} />
        <p className="flex items-center gap-2 rounded-lg border border-warning bg-warning-surface px-3 py-2 text-small text-warning">
          2 minutes left. The session ends on time and can&apos;t be extended.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {["pending", "expired", "declined", "failed_payment", "accepted"].map((s) => (
          <Button key={s} variant="outline" size="sm" onClick={() => setWaiting(s)}>
            Student wait: {s}
          </Button>
        ))}
      </div>
      <Modal open={waiting !== null} onOpenChange={(o) => !o && setWaiting(null)}>
        <ModalContent size="sm">
          {waiting && (
            <WaitingForTutor
              tutorName="Liam Bennett"
              priceCredits={23}
              secondsLeft={42}
              fraction={0.7}
              elapsed={false}
              status={waiting}
              onClose={() => setWaiting(null)}
              onBookTime={() => setWaiting(null)}
            />
          )}
        </ModalContent>
      </Modal>
    </Section>
  );
}
