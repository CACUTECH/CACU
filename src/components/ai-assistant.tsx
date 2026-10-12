"use client";

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { AI_UNAVAILABLE_MESSAGE } from '@/lib/ai-availability';

export function AIAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  return <>
    <Button aria-label="AI assistant availability" onClick={() => setIsOpen(true)}
      className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg z-50" size="icon">
      <Sparkles className="h-6 w-6" aria-hidden="true" />
    </Button>
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>CACU AI Assistant</SheetTitle>
          <SheetDescription>{AI_UNAVAILABLE_MESSAGE}</SheetDescription>
        </SheetHeader>
        <p className="mt-6 text-sm text-muted-foreground">
          No page data or questions are sent to an AI provider. Use the dashboard and
          reports to review your recorded figures.
        </p>
        <Button className="mt-6" variant="outline" onClick={() => setIsOpen(false)}>Close</Button>
      </SheetContent>
    </Sheet>
  </>;
}
