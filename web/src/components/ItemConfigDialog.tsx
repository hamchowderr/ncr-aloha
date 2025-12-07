import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import type { MenuItem, MenuItemSize, Modifier, ModifierGroup } from "@/types/menu";

interface ItemConfigDialogProps {
  item: MenuItem | null;
  modifierGroups: ModifierGroup[];
  open: boolean;
  onClose: () => void;
  onAdd: (
    item: MenuItem,
    size: MenuItemSize | undefined,
    modifiers: Modifier[],
    quantity: number
  ) => void;
}

export function ItemConfigDialog({
  item,
  modifierGroups,
  open,
  onClose,
  onAdd,
}: ItemConfigDialogProps) {
  const [selectedSize, setSelectedSize] = useState<MenuItemSize | undefined>();
  const [selectedModifiers, setSelectedModifiers] = useState<Modifier[]>([]);
  const [quantity, setQuantity] = useState(1);

  if (!item) return null;

  const itemModifierGroups = modifierGroups.filter(
    (g) => item.modifierGroups?.includes(g.id)
  );

  const toggleModifier = (modifier: Modifier) => {
    setSelectedModifiers((prev) => {
      const exists = prev.find((m) => m.id === modifier.id);
      if (exists) {
        return prev.filter((m) => m.id !== modifier.id);
      }
      return [...prev, modifier];
    });
  };

  const handleAdd = () => {
    const size = selectedSize || item.sizes?.[0];
    onAdd(item, size, selectedModifiers, quantity);
    handleClose();
  };

  const handleClose = () => {
    setSelectedSize(undefined);
    setSelectedModifiers([]);
    setQuantity(1);
    onClose();
  };

  let unitPrice = item.basePrice;
  if (selectedSize) unitPrice += selectedSize.priceAdjustment;
  else if (item.sizes?.[0]) unitPrice += item.sizes[0].priceAdjustment;
  selectedModifiers.forEach((m) => (unitPrice += m.price));

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">{item.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Size Selection */}
          {item.sizes && item.sizes.length > 0 && (
            <div className="space-y-3">
              <Label className="text-base font-semibold">Size</Label>
              <div className="flex flex-wrap gap-2">
                {item.sizes.map((size, idx) => (
                  <Button
                    key={size.id}
                    variant={
                      (selectedSize?.id || item.sizes?.[0]?.id) === size.id
                        ? "default"
                        : "outline"
                    }
                    size="sm"
                    onClick={() => setSelectedSize(size)}
                  >
                    {size.name}
                    {size.priceAdjustment > 0 && (
                      <span className="ml-1 text-xs opacity-75">
                        +${size.priceAdjustment.toFixed(2)}
                      </span>
                    )}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Modifier Groups */}
          {itemModifierGroups.map((group) => (
            <div key={group.id} className="space-y-3">
              <Separator />
              <div className="flex items-center gap-2">
                <Label className="text-base font-semibold">{group.name}</Label>
                {group.required && (
                  <Badge variant="destructive" className="text-xs">
                    Required
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {group.modifiers.slice(0, 10).map((modifier) => {
                  const isSelected = selectedModifiers.some(
                    (m) => m.id === modifier.id
                  );
                  return (
                    <Button
                      key={modifier.id}
                      variant={isSelected ? "default" : "outline"}
                      size="sm"
                      onClick={() => toggleModifier(modifier)}
                    >
                      {modifier.name}
                      {modifier.price > 0 && (
                        <span className="ml-1 text-xs opacity-75">
                          +${modifier.price.toFixed(2)}
                        </span>
                      )}
                    </Button>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Quantity */}
          <div className="space-y-3">
            <Separator />
            <Label className="text-base font-semibold">Quantity</Label>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              >
                -
              </Button>
              <Input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-20 text-center"
                min={1}
                max={99}
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => setQuantity((q) => Math.min(99, q + 1))}
              >
                +
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <div className="flex w-full items-center justify-between">
            <div className="text-lg font-bold">
              ${(unitPrice * quantity).toFixed(2)}
            </div>
            <Button onClick={handleAdd} size="lg">
              Add to Order
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
