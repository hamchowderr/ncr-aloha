import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { MenuItem } from "@/types/menu";

interface MenuItemCardProps {
  item: MenuItem;
  onClick: () => void;
}

export function MenuItemCard({ item, onClick }: MenuItemCardProps) {
  return (
    <Card
      className="cursor-pointer transition-all hover:scale-[1.02] hover:shadow-lg"
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="font-semibold text-lg">{item.name}</h3>
            {item.sizes && (
              <p className="text-sm text-muted-foreground">
                {item.sizes.length} sizes available
              </p>
            )}
          </div>
          <Badge variant="secondary" className="text-lg font-bold">
            ${item.basePrice.toFixed(2)}
            {item.sizes && "+"}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
