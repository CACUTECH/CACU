import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function FeatureUnavailable({ title, description }: { title: string; description: string }) {
  return <div className="mx-auto w-full max-w-2xl space-y-6">
    <h1 className="font-headline text-3xl font-bold">{title}</h1>
    <Card><CardHeader><CardTitle>Not available yet</CardTitle>
      <CardDescription>{description}</CardDescription></CardHeader>
      <CardContent><Button asChild variant="outline"><Link href="/">Back to dashboard</Link></Button></CardContent>
    </Card>
  </div>;
}
