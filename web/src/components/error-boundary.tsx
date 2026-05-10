import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Props = { children: React.ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("[error-boundary]", error, info);
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <main className="flex min-h-svh items-center justify-center bg-background p-8 text-foreground">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Something went wrong</CardTitle>
              <CardDescription>
                The admin UI hit an unexpected error.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <pre className="max-h-40 overflow-auto rounded bg-muted p-3 text-xs text-muted-foreground">
                {this.state.error.message}
              </pre>
              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={() => this.setState({ error: null })}
                >
                  Try again
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => window.location.reload()}
                >
                  Reload
                </Button>
              </div>
            </CardContent>
          </Card>
        </main>
      );
    }
    return this.props.children;
  }
}
