"use client";

import { ChevronDown, Ellipsis } from "lucide-react";
import { Section, Demo, muted, type Surface } from "./kit";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Modal,
  ModalClose,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTrigger,
} from "@/components/ui/modal";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  DrawerClose,
} from "@/components/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function OverlaysSection({ surface }: { surface: Surface }) {
  return (
    <Section id="overlays" title="Overlays & navigation" surface={surface}>
      <Demo label="Tabs" surface={surface} className="items-stretch">
        <Tabs defaultValue="upcoming" className="w-full">
          <TabsList>
            <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
            <TabsTrigger value="past">Past</TabsTrigger>
            <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
          </TabsList>
          <TabsContent value="upcoming">
            <p className={cn("text-body", muted(surface))}>
              Two upcoming sessions this week.
            </p>
          </TabsContent>
          <TabsContent value="past">
            <p className={cn("text-body", muted(surface))}>
              Your completed sessions live here.
            </p>
          </TabsContent>
          <TabsContent value="cancelled">
            <p className={cn("text-body", muted(surface))}>
              Nothing cancelled — nice.
            </p>
          </TabsContent>
        </Tabs>
      </Demo>

      <Demo label="Modal · Drawer · Dropdown" surface={surface}>
        <Modal>
          <ModalTrigger asChild>
            <Button variant="secondary">Open modal</Button>
          </ModalTrigger>
          <ModalContent>
            <ModalHeader>
              <ModalTitle>Cancel this session?</ModalTitle>
              <ModalDescription>
                You’re within the free-cancellation window, so you’ll get a full
                credit refund.
              </ModalDescription>
            </ModalHeader>
            <ModalFooter>
              <ModalClose asChild>
                <Button variant="secondary">Keep session</Button>
              </ModalClose>
              <ModalClose asChild>
                <Button variant="danger">Cancel & refund</Button>
              </ModalClose>
            </ModalFooter>
          </ModalContent>
        </Modal>

        <Drawer>
          <DrawerTrigger asChild>
            <Button variant="secondary">Open drawer</Button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Filters</DrawerTitle>
            </DrawerHeader>
            <DrawerBody>
              <p className="text-body text-gray-500">
                Filter controls (subject, price, language) live here on real
                pages.
              </p>
            </DrawerBody>
            <DrawerFooter>
              <DrawerClose asChild>
                <Button variant="secondary" className="flex-1">
                  Clear
                </Button>
              </DrawerClose>
              <DrawerClose asChild>
                <Button className="flex-1">Apply</Button>
              </DrawerClose>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary">
              Sort <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Sort by</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked>Relevance</DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem>Rating</DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem>Price</DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="More actions">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>View details</DropdownMenuItem>
            <DropdownMenuItem>Message tutor</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive>Cancel booking</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Demo>
    </Section>
  );
}
