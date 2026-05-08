"use client";

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sparkles, Send, Loader2, Bot, MessageSquare } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { usePathname } from 'next/navigation';
import { getBusinessInsight } from '@/ai/flows/business-insights-flow';
import { cn } from '@/lib/utils';

type Message = {
  role: 'user' | 'assistant';
  content: string;
  suggestions?: string[];
};

export function AIAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const pathname = usePathname();

  const getPageData = () => {
    if (typeof document === 'undefined') return '';
    const mainContent = document.querySelector('main');
    if (!mainContent) return '';
    
    // Get visible text content, limited to prevent token overflow
    return mainContent.innerText.slice(0, 2000).replace(/\s+/g, ' ');
  };

  const handleSend = async (customQuery?: string) => {
    const activeQuery = customQuery || query;
    if (!activeQuery.trim()) return;

    const userMessage: Message = { role: 'user', content: activeQuery };
    setMessages(prev => [...prev, userMessage]);
    setQuery('');
    setIsLoading(true);

    try {
      const pageName = pathname === '/' ? 'Dashboard' : pathname.split('/').pop() || 'General';
      const visibleData = getPageData();
      
      const result = await getBusinessInsight({
        context: `User is on the ${pageName} page. Visible data on page: ${visibleData}`,
        userQuery: activeQuery,
      });

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: result.insight,
        suggestions: result.suggestions
      }]);
    } catch (error) {
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: "I'm sorry, I couldn't process that right now. Please try again." 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-2xl hover:scale-110 transition-transform z-50 bg-primary text-primary-foreground group"
        size="icon"
      >
        <Sparkles className="h-6 w-6 group-hover:rotate-12 transition-transform" />
      </Button>

      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent className="sm:max-w-md flex flex-col h-full border-l shadow-2xl border-primary/10">
          <SheetHeader className="border-b pb-4">
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 p-2.5 rounded-xl">
                <Bot className="h-6 w-6 text-primary" />
              </div>
              <div className="text-left">
                <SheetTitle className="font-headline text-xl">CACU AI Assistant</SheetTitle>
                <SheetDescription>Context-aware business insights.</SheetDescription>
              </div>
            </div>
          </SheetHeader>

          <ScrollArea className="flex-grow my-4 pr-4">
            <div className="space-y-6">
              {messages.length === 0 && (
                <div className="space-y-4">
                  <div className="bg-muted/50 rounded-2xl p-4 text-sm text-muted-foreground border border-border/50 shadow-inner">
                    <p className="font-medium text-foreground mb-1">Hello! 👋</p>
                    I've analyzed the data on your current page. How can I help you grow your business today?
                  </div>
                  <div className="grid gap-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="justify-start text-xs font-normal h-auto py-2 px-3 rounded-full bg-primary/5 border-primary/20 text-primary hover:bg-primary/10 shadow-sm"
                      onClick={() => handleSend("Analyze the data on this page for me")}
                    >
                      <Sparkles className="mr-2 h-3 w-3" />
                      Analyze current page
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="justify-start text-xs font-normal h-auto py-2 px-3 rounded-full shadow-sm"
                      onClick={() => handleSend("How can I improve my current numbers?")}
                    >
                      <MessageSquare className="mr-2 h-3 w-3" />
                      Tips to improve performance
                    </Button>
                  </div>
                </div>
              )}
              
              {messages.map((m, i) => (
                <div key={i} className={cn("flex flex-col gap-2", m.role === 'user' ? 'items-end' : 'items-start')}>
                  <div className={cn(
                    "max-w-[85%] rounded-2xl p-4 text-sm shadow-md",
                    m.role === 'user' 
                      ? 'bg-primary text-primary-foreground rounded-tr-none' 
                      : 'bg-card border border-border/50 rounded-tl-none'
                  )}>
                    {m.content}
                  </div>
                  {m.suggestions && m.suggestions.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-1">
                      {m.suggestions.map((s, si) => (
                        <button
                          key={si}
                          onClick={() => handleSend(s)}
                          className="text-[10px] uppercase tracking-wider font-bold bg-secondary hover:bg-primary/10 hover:text-primary text-secondary-foreground px-3 py-1.5 rounded-full transition-all border shadow-sm"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              
              {isLoading && (
                <div className="flex items-center gap-3 text-muted-foreground">
                  <div className="bg-primary/5 p-2 rounded-full animate-pulse">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-xs font-medium">Analyzing business context...</span>
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="pt-4 border-t mt-auto">
            <form
              onSubmit={(e) => { e.preventDefault(); handleSend(); }}
              className="flex items-center gap-2"
            >
              <Input
                placeholder="Ask about this page..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={isLoading}
                className="flex-grow rounded-xl border-muted focus-visible:ring-primary h-11 shadow-sm"
              />
              <Button 
                type="submit" 
                size="icon" 
                disabled={isLoading || !query.trim()}
                className="h-11 w-11 rounded-xl shadow-lg hover:shadow-primary/20 transition-all"
              >
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
