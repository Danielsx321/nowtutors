"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Demo, Section, type Surface } from "./kit";

const variants = ["primary", "secondary", "ghost", "danger"] as const;
const sizes = ["sm", "md", "lg"] as const;

export function ButtonsSection({ surface }: { surface: Surface }) {
  return (
    <Section id="buttons" title="Button" surface={surface}>
      <Demo label="Variants (md)" surface={surface}>
        {variants.map((v) => (
          <Button key={v} variant={v}>
            {v[0].toUpperCase() + v.slice(1)}
          </Button>
        ))}
      </Demo>

      <Demo label="Sizes (primary)" surface={surface}>
        {sizes.map((s) => (
          <Button key={s} size={s}>
            Size {s}
          </Button>
        ))}
        <Button size="icon" aria-label="Add">
          <Plus />
        </Button>
      </Demo>

      <Demo label="With icon" surface={surface}>
        <Button>
          <Plus /> New booking
        </Button>
        <Button variant="secondary">
          <Plus /> Add subject
        </Button>
      </Demo>

      <Demo label="Loading" surface={surface}>
        {variants.map((v) => (
          <Button key={v} variant={v} loading>
            Saving
          </Button>
        ))}
      </Demo>

      <Demo label="Disabled" surface={surface}>
        {variants.map((v) => (
          <Button key={v} variant={v} disabled>
            Disabled
          </Button>
        ))}
      </Demo>
    </Section>
  );
}
