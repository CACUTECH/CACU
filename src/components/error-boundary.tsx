'use client';

import React, { ErrorInfo, ReactNode } from 'react';
import { logger } from '@/lib/logger';
import { Button } from '@/components/ui/button';
import { AlertCircle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(_: Error): State {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error('Frontend Exception Caught', error, { 
      componentStack: errorInfo.componentStack 
    }, 'ErrorBoundary');
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center space-y-6">
          <div className="bg-red-50 p-6 rounded-3xl">
            <AlertCircle className="h-16 w-16 text-red-600 mx-auto" />
          </div>
          <div className="max-w-md space-y-2">
            <h1 className="font-headline text-3xl font-bold">Something went wrong</h1>
            <p className="text-muted-foreground">
              An unexpected error occurred. Our team has been notified. 
              Please try refreshing the page.
            </p>
          </div>
          <Button 
            onClick={() => window.location.reload()} 
            className="rounded-xl h-12 px-8"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Reload Application
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
