import * as React from "react";
import { GraduationCap, Presentation } from "lucide-react";
import { Section, Demo, type Surface } from "./kit";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { FieldError } from "@/components/ui/field-error";
import { RoleCard } from "@/components/features/onboarding/onboarding-flow";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { HeartOff } from "lucide-react";

/**
 * Auth & onboarding building blocks (Phase 3). The full flows live at /login,
 * /signup, /forgot-password and /onboarding — those recompose existing form
 * primitives, so the only net-new composed UI worth a gallery slot is the
 * onboarding role-choice card (shown here) plus a field in its error state.
 */
export function AuthSection({ surface }: { surface: Surface }) {
  return (
    <Section id="auth" title="Auth & onboarding" surface={surface}>
      <Demo label="Onboarding role choice" surface={surface} className="!block">
        <div className="grid max-w-xl gap-4 sm:grid-cols-2">
          <RoleCard
            icon={<GraduationCap className="size-7" aria-hidden />}
            title="I want to learn"
            description="Find tutors, book sessions, and go live instantly."
            onClick={() => {}}
          />
          <RoleCard
            icon={<Presentation className="size-7" aria-hidden />}
            title="I want to teach"
            description="Create a tutor profile, set your rate, and earn."
            onClick={() => {}}
          />
        </div>
      </Demo>

      <Demo label="Auth field — default & error" surface={surface} className="!block">
        <div className="grid max-w-xl gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ks-email" required>
              Email
            </Label>
            <Input id="ks-email" type="email" defaultValue="you@example.com" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ks-email-err" required>
              Email
            </Label>
            <Input id="ks-email-err" type="email" defaultValue="not-an-email" invalid />
            <FieldError>Enter a valid email address.</FieldError>
          </div>
        </div>
      </Demo>
      <Demo label="Admin queue — re-review flag" surface={surface} className="!block">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="warning">Edited since review</Badge>
          <Badge variant="purple">3</Badge>
          <span className="text-caption text-gray-500">
            approved tutors stay live and bookable while flagged (§4.1)
          </span>
        </div>
      </Demo>

      <Demo label="Favourites — empty state" surface={surface} className="!block">
        <div className="max-w-xl">
          <EmptyState
            icon={<HeartOff className="size-6" />}
            title="No saved tutors yet"
            description="Tap the heart on any tutor to save them here for later."
          />
        </div>
      </Demo>
    </Section>
  );
}
