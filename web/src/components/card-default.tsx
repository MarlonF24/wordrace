import { Card, CardContent } from "@/components/ui/card";

export default function CardDemo() {
  return (
    <Card className="w-full max-w-sm">
      <CardContent>
        <p className="text-sm">This is the card content. Other content is added here.</p>
      </CardContent>
    </Card>
  );
}
