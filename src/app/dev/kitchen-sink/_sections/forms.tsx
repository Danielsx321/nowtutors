"use client";

import * as React from "react";
import { Section, type Surface } from "./kit";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/ui/field-error";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio";
import { Switch } from "@/components/ui/switch";
import { DatePicker } from "@/components/ui/date-picker";
import { TimePicker } from "@/components/ui/time-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function Field({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`space-y-1.5 ${className ?? ""}`}>{children}</div>;
}

export function FormsSection({ surface }: { surface: Surface }) {
  const [check, setCheck] = React.useState<boolean | "indeterminate">(true);
  const [radio, setRadio] = React.useState("30");
  const [on, setOn] = React.useState(true);
  const [subject, setSubject] = React.useState<string>();
  const [date, setDate] = React.useState<Date>();
  const [time, setTime] = React.useState<string>();

  return (
    <Section id="forms" title="Form controls" surface={surface}>
      {/* Forms are light-surface components; in the dark shell they live on a
          Card, so we demo them that way regardless of the page surface. */}
      <Card className="grid gap-6 p-6 md:grid-cols-2">
        <Field>
          <Label htmlFor="ks-name" required>
            Full name
          </Label>
          <Input id="ks-name" placeholder="Ada Lovelace" />
        </Field>

        <Field>
          <Label htmlFor="ks-email">Email (invalid)</Label>
          <Input
            id="ks-email"
            invalid
            defaultValue="not-an-email"
            aria-describedby="ks-email-err"
          />
          <FieldError id="ks-email-err">Enter a valid email address.</FieldError>
        </Field>

        <Field>
          <Label htmlFor="ks-disabled">Disabled</Label>
          <Input id="ks-disabled" disabled placeholder="Unavailable" />
        </Field>

        <Field>
          <Label htmlFor="ks-subject">Subject (Select)</Label>
          <Select value={subject} onValueChange={setSubject}>
            <SelectTrigger id="ks-subject">
              <SelectValue placeholder="Choose a subject" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="math">Mathematics</SelectItem>
              <SelectItem value="physics">Physics</SelectItem>
              <SelectItem value="english">English</SelectItem>
              <SelectItem value="chem">Chemistry</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field className="md:col-span-2">
          <Label htmlFor="ks-notes">What do you want help with?</Label>
          <Textarea id="ks-notes" placeholder="A short note for your tutor…" />
        </Field>

        <Field>
          <Label htmlFor="ks-date">Date</Label>
          <DatePicker id="ks-date" value={date} onChange={setDate} />
        </Field>

        <Field>
          <Label htmlFor="ks-time">Time</Label>
          <TimePicker id="ks-time" value={time} onChange={setTime} />
        </Field>

        <Field>
          <span className="text-small font-medium text-gray-700">Checkbox</span>
          <div className="flex flex-col gap-2 pt-1">
            <label className="flex items-center gap-2 text-body text-gray-700">
              <Checkbox
                checked={check}
                onCheckedChange={(c) => setCheck(c)}
              />
              Toggle me
            </label>
            <label className="flex items-center gap-2 text-body text-gray-700">
              <Checkbox
                checked="indeterminate"
                onCheckedChange={() => setCheck(true)}
              />
              Indeterminate
            </label>
            <label className="flex items-center gap-2 text-body text-gray-500">
              <Checkbox disabled /> Disabled
            </label>
          </div>
        </Field>

        <Field>
          <span className="text-small font-medium text-gray-700">
            Radio — duration
          </span>
          <RadioGroup value={radio} onValueChange={setRadio} className="pt-1">
            {["30", "60", "90"].map((v) => (
              <label
                key={v}
                className="flex items-center gap-2 text-body text-gray-700"
              >
                <RadioGroupItem value={v} /> {v} minutes
              </label>
            ))}
          </RadioGroup>
        </Field>

        <Field className="md:col-span-2">
          <span className="text-small font-medium text-gray-700">Switch</span>
          <label className="flex items-center gap-3 pt-1 text-body text-gray-700">
            <Switch checked={on} onCheckedChange={setOn} />
            Available for instant sessions
          </label>
        </Field>
      </Card>
    </Section>
  );
}
