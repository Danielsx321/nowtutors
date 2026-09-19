"use client";

import * as React from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateSetting } from "@/actions/admin-settings";

export interface EditableSetting {
  key: string;
  label: string;
  help: string;
  input: "number" | "json";
  readOnlyReason: string | null;
  /** The current value as editor text, or null when the key has no row. */
  text: string | null;
  /** The current value as JSON, sent back so a stale save is refused. */
  expected: string | null;
}

function SettingCard({
  setting,
  savedNote,
  onSaved,
}: {
  setting: EditableSetting;
  savedNote: string | null;
  onSaved: (note: string) => void;
}) {
  const [text, setText] = React.useState(setting.text ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const id = `setting-${setting.key}`;
  const dirty = text !== (setting.text ?? "");

  const save = () =>
    start(async () => {
      setError(null);
      const res = await updateSetting({ key: setting.key, value: text, expected: setting.expected });
      if ("error" in res) setError(res.error);
      else onSaved(res.changed ? "Saved." : "No change: that's already the value.");
    });

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Label htmlFor={id} className="text-body-lg font-bold text-text">
            {setting.label}
          </Label>
          <code className="text-caption text-text-muted">{setting.key}</code>
        </div>
        <p className="text-small text-text-muted">{setting.help}</p>

        {setting.readOnlyReason ? (
          <>
            <pre className="overflow-auto rounded-md bg-surface-muted p-3 text-small text-text">
              {setting.text ?? "Not set"}
            </pre>
            <Alert variant="info">{setting.readOnlyReason}</Alert>
          </>
        ) : (
          <>
            {setting.text === null && (
              <Alert variant="warning">Not set. Saving creates it.</Alert>
            )}
            {setting.input === "number" ? (
              <Input
                id={id}
                inputMode="decimal"
                value={text}
                invalid={Boolean(error)}
                onChange={(e) => setText(e.target.value)}
                className="max-w-48"
                autoComplete="off"
              />
            ) : (
              <Textarea
                id={id}
                value={text}
                invalid={Boolean(error)}
                onChange={(e) => setText(e.target.value)}
                rows={Math.min(16, Math.max(3, text.split("\n").length))}
                spellCheck={false}
                className="font-mono text-small"
              />
            )}
            {error && <Alert variant="danger">{error}</Alert>}
            {!error && savedNote && <p className="text-small text-success">{savedNote}</p>}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" loading={pending} disabled={!dirty} onClick={save}>
                Save
              </Button>
              {dirty && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    setText(setting.text ?? "");
                    setError(null);
                  }}
                >
                  Discard
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The `platform_settings` editor (SPEC §4.7; Phase 8 Part 4). One card per key.
 * Each card is keyed by the value it was rendered with, so after a save the
 * refreshed server value replaces the local text instead of fighting it.
 */
export function SettingsEditor({ settings }: { settings: EditableSetting[] }) {
  const [saved, setSaved] = React.useState<{ key: string; note: string } | null>(null);
  return (
    <div className="space-y-4">
      {settings.map((s) => (
        <SettingCard
          key={`${s.key}:${s.expected ?? "unset"}`}
          setting={s}
          savedNote={saved?.key === s.key ? saved.note : null}
          onSaved={(note) => setSaved({ key: s.key, note })}
        />
      ))}
    </div>
  );
}
